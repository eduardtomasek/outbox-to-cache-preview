/**
 * RabbitConsumerDiscovery
 *
 * Automatická registrace RabbitMQ consumerů na základě dekorátoru @RabbitConsumer().
 *
 * PROČ TO EXISTUJE:
 * Bez tohoto mechanismu by každý consumer musel ručně volat rabbitmqService.createChannel(),
 * nastavovat prefetch, parsovat zprávy a řešit ack/nack — opakující se boilerplate kód.
 * Místo toho stačí na libovolnou metodu v libovolném provideru dát dekorátor:
 *
 *   @RabbitConsumer({ queue: 'my-queue', prefetch: 5 })
 *   async handleMessage(payload: unknown) { ... }
 *
 * A tato třída se při startu aplikace postará o vše ostatní.
 *
 * JAK TO FUNGUJE:
 * 1. Implementuje OnApplicationBootstrap — NestJS ji zavolá po inicializaci všech modulů.
 * 2. Přes DiscoveryService získá seznam VŠECH providerů v celé aplikaci.
 * 3. Přes MetadataScanner projde všechny metody každého provideru.
 * 4. Přes Reflector zkontroluje, zda metoda nese metadata z @RabbitConsumer() dekorátoru.
 * 5. Pokud ano, vytvoří pro ni dedikovaný AMQP channel a zaregistruje consumer callback.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import * as amqp from 'amqplib';
import { RABBITMQ_CONSUMER_META, RabbitmqConsumerOptions } from './decorators/rabbitmq-consumer.decorator';
import { RabbitmqService } from './rabbitmq.service';

@Injectable()
export class RabbitConsumerDiscovery implements OnApplicationBootstrap {
    private readonly logger = new Logger(RabbitConsumerDiscovery.name);

    /** Uložené registrace consumerů pro re-subscribe po reconnectu. */
    private readonly registrations: {
        instance: Record<string, (...args: unknown[]) => unknown>;
        methodName: string;
        options: RabbitmqConsumerOptions;
    }[] = [];

    constructor(
        // DiscoveryService — interní NestJS utilita, která umožňuje za běhu procházet
        // všechny registrované providery (služby, repozitáře, handlery…) napříč celou aplikací.
        private readonly discovery: DiscoveryService,

        // MetadataScanner — prochází prototypový řetězec instance a vrací názvy všech metod.
        // Potřebujeme ho, protože Object.keys() by vrátil jen vlastní property, ne metody z prototypu.
        private readonly scanner: MetadataScanner,

        // Reflector — čte metadata nastavená přes SetMetadata / custom dekorátory.
        // Díky němu zjistíme, zda konkrétní metoda nese konfiguraci @RabbitConsumer().
        private readonly reflector: Reflector,

        private readonly rabbitmq: RabbitmqService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        // Čekáme na deferred promise z RabbitmqService, která se resolve-ne
        // až po úspěšném connect(). Důvod: NestJS nevolá onApplicationBootstrap
        // hooky v garantovaném pořadí napříč providery — bez tohoto awaitu by
        // createChannel() mohl být zavolán dříve, než se naváže spojení.
        await this.rabbitmq.ready;

        await this.discoverAndRegisterAll();

        // Po reconnectu se všechny consumer channely zruší (spadly s connection).
        // Zaregistrujeme callback, který je znovu vytvoří na novém spojení.
        this.rabbitmq.onReconnect(async () => {
            this.logger.log('Re-registering all consumers after reconnect…');
            await this.reregisterAll();
        });
    }

    /**
     * Projde všechny providery v aplikaci, najde metody s @RabbitConsumer()
     * a zaregistruje je. Zároveň si uloží registrace pro pozdější re-subscribe.
     */
    private async discoverAndRegisterAll(): Promise<void> {
        // DiscoveryService vrací wrappery kolem všech providerů v DI kontejneru.
        // Wrapper obsahuje metadata o provideru (token, scope…) a reálnou instanci.
        const providers = this.discovery.getProviders();

        for (const wrapper of providers) {
            const instance = wrapper.instance as Record<string, (...args: unknown[]) => unknown> | null;

            // Některé wrappery nemusí mít instanci (např. abstrakt, factory provider bez použití,
            // nebo provider v REQUEST scope, který ještě nebyl vytvořen).
            // Kontrola prototypu filtruje čisté objekty {} bez metod.
            if (!instance || !Object.getPrototypeOf(instance)) {
                continue;
            }

            // MetadataScanner projde prototyp instance a vrátí názvy všech metod
            // (vlastních i zděděných), kromě konstruktoru.
            const methodNames = this.scanner.getAllMethodNames(instance);

            for (const methodName of methodNames) {
                // Reflector.get zkusí přečíst metadata pod klíčem RABBITMQ_CONSUMER_META
                // z konkrétní metody. Pokud metoda nemá @RabbitConsumer() dekorátor,
                // vrátí undefined a my ji přeskočíme.
                const options = this.reflector.get<RabbitmqConsumerOptions>(
                    RABBITMQ_CONSUMER_META,
                    instance[methodName],
                );

                if (!options) {
                    continue;
                }

                // Uložíme si registraci pro pozdější re-subscribe po reconnectu.
                this.registrations.push({ instance, methodName, options });

                await this.registerConsumer(instance, methodName, options);
            }
        }
    }

    /**
     * Po reconnectu znovu zaregistruje všechny dříve objevené consumery.
     * Discovery se neopakuje — instance providerů jsou stále stejné,
     * jen channely je potřeba vytvořit nové na novém spojení.
     */
    private async reregisterAll(): Promise<void> {
        for (const { instance, methodName, options } of this.registrations) {
            await this.registerConsumer(instance, methodName, options);
        }
    }

    /**
     * Vytvoří dedikovaný AMQP channel a zaregistruje na něm consumer pro danou frontu.
     *
     * Proč dedikovaný channel na každého consumera:
     * - AMQP channel není thread-safe pro souběžný publish + consume.
     * - Oddělené channely izolují prefetch (QoS) — každý consumer může mít jiný limit.
     * - Pád jednoho channelu (např. kvůli chybě v serializaci) neshodí ostatní consumery.
     */
    private async registerConsumer(
        instance: Record<string, (...args: unknown[]) => unknown>,
        methodName: string,
        options: RabbitmqConsumerOptions,
    ): Promise<void> {
        const channel = await this.rabbitmq.createChannel();

        // Prefetch (QoS) omezuje, kolik neack-nutých zpráv může RabbitMQ tomuto
        // consumeru poslat najednou. Bez prefetche by RabbitMQ zahltil consumera
        // všemi zprávami z fronty naráz → memory spike, pomalé zpracování.
        if (options.prefetch) {
            await channel.prefetch(options.prefetch);
        }

        if (options.batch) {
            await this.registerBatchConsumer(channel, instance, methodName, options);
        } else {
            await this.registerSingleConsumer(channel, instance, methodName, options);
        }

        this.logger.log(`Registered consumer: ${instance.constructor.name}.${methodName} → ${options.queue}`);
    }

    /**
     * Standardní consumer — každá zpráva vyvolá handler zvlášť.
     */
    private async registerSingleConsumer(
        channel: amqp.Channel,
        instance: Record<string, (...args: unknown[]) => unknown>,
        methodName: string,
        options: RabbitmqConsumerOptions,
    ): Promise<void> {
        await channel.consume(options.queue, (msg) => {
            if (!msg) return;

            void (async () => {
                try {
                    const payload: unknown = JSON.parse(msg.content.toString());
                    await instance[methodName].call(instance, payload, msg);
                    channel.ack(msg);
                } catch (err) {
                    this.logger.error(
                        `Error in consumer ${(instance.constructor as { name: string }).name}.${methodName}`,
                        err,
                    );
                    channel.nack(msg, false, false);
                }
            })();
        });
    }

    /**
     * Batch consumer — bufferuje zprávy a handler volá s celým polem najednou.
     *
     * Flush nastane když:
     * 1. Buffer dosáhne batch.size → okamžitý flush.
     * 2. Vyprší batch.timeoutMs od příchodu první zprávy v aktuálním batchi
     *    → flush i s neúplným batchem (chrání proti čekání při low traffic).
     *
     * Handler dostane pole BufferedRabbitMqMessage[]. Při úspěchu se ack-nou
     * všechny zprávy najednou (AMQP multiple ack). Při chybě se nack-nou všechny do DLQ.
     *
     * DŮLEŽITÉ: prefetch musí být ≥ batch.size, jinak se plný batch nikdy nenaplní.
     */
    private async registerBatchConsumer(
        channel: amqp.Channel,
        instance: Record<string, (...args: unknown[]) => unknown>,
        methodName: string,
        options: RabbitmqConsumerOptions,
    ): Promise<void> {
        const { size, timeoutMs } = options.batch!;
        let buffer: amqp.ConsumeMessage[] = [];
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        let flushing = false;

        const flush = async () => {
            if (buffer.length === 0 || flushing) return;
            flushing = true;

            const batch = buffer;
            buffer = [];
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }

            try {
                const payloads = batch.map((msg) => ({
                    raw: msg,
                    parsed: JSON.parse(msg.content.toString()) as unknown,
                }));

                await instance[methodName].call(instance, payloads);

                // multiple=true ack-ne všechny zprávy s delivery tag ≤ poslední zprávy.
                // Funguje, protože delivery tagy jsou sekvenční v rámci jednoho channelu.
                channel.ack(batch[batch.length - 1], true);
            } catch (err) {
                this.logger.error(
                    `Batch error in ${(instance.constructor as { name: string }).name}.${methodName}`,
                    err,
                );
                // multiple=true nack-ne celý batch. requeue=false → zprávy jdou do DLQ.
                channel.nack(batch[batch.length - 1], true, false);
            } finally {
                flushing = false;
            }
        };

        await channel.consume(options.queue, (msg) => {
            if (!msg) return;

            buffer.push(msg);

            if (buffer.length >= size) {
                void flush();
            } else if (!flushTimer) {
                flushTimer = setTimeout(() => void flush(), timeoutMs);
            }
        });
    }
}
