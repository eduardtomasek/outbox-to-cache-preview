/**
 * RabbitmqService
 *
 * Centrální služba pro komunikaci s RabbitMQ. Spravuje:
 * - AMQP spojení (connect, reconnect, graceful shutdown)
 * - Jeden sdílený publish channel pro odesílání zpráv
 * - Továrnu na dedikované consumer channely
 *
 * PROČ JEDEN PUBLISH CHANNEL:
 * amqplib channel je interně serializovaný pro publish operace — souběžné
 * volání publish() z různých částí aplikace je bezpečné. Sdílený channel
 * šetří prostředky (každý channel = TCP multiplexovaný stream + paměť na serveru).
 *
 * PROČ ODDĚLENÉ CONSUMER CHANNELY:
 * Viz createChannel() — každý consumer dostane vlastní channel, protože:
 * - prefetch (QoS) se nastavuje per-channel
 * - pád channelu izoluje selhání jednoho consumera od ostatních
 * - mix publish + consume na jednom channelu není thread-safe
 *
 * RECONNECT STRATEGIE:
 * Při ztrátě spojení (heartbeat timeout, network drop) se automaticky
 * spustí reconnect s exponenciálním back-off (1s, 2s, 4s, 8s…).
 * Po úspěšném reconnectu se emituje 'reconnect' event, na který může
 * reagovat RabbitConsumerDiscovery a znovu zaregistrovat consumer channely.
 */
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { EventEmitter } from 'node:events';
import { RabbitMqMessageEnvelope } from './interfaces/rabbitmq.interfaces';
import { RabbitmqTopologyService } from './rabbitmq.topology.service';

export type PublishOptions = {
    /** Zpráva přežije restart brokeru (ukládá se na disk). Default: true. */
    persistent?: boolean;
    /** Unikátní ID zprávy — hodí se pro idempotenci a tracing. */
    messageId?: string;
    /** Custom AMQP hlavičky (x-delay, x-retry-count…). */
    headers?: Record<string, unknown>;
};

/** Maximální počet po sobě jdoucích pokusů o reconnect, než se přestane zkoušet. */
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Výchozí prodleva mezi pokusy o reconnect (v ms).
 * Reálná prodleva roste exponenciálně: BASE * 2^attempt → 1s, 2s, 4s, 8s, 16s…
 * Exponenciální back-off chrání RabbitMQ server před zahlcením pokusy o připojení
 * v situaci, kdy je dočasně nedostupný (restart, síťový výpadek).
 */
const BASE_RECONNECT_DELAY_MS = 1_000;

@Injectable()
export class RabbitmqService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(RabbitmqService.name);

    /**
     * Interní EventEmitter pro notifikaci o reconnectu.
     * Proč ne NestJS EventEmitter2: nepotřebujeme DI, global scope ani wildcard —
     * stačí jednoduchý Node.js emitter pro interní koordinaci v rámci této služby.
     */
    private readonly emitter = new EventEmitter();

    /**
     * Deferred promise pattern — umožňuje resolve-ovat promise z jiné metody.
     *
     * Proč: RabbitConsumerDiscovery a další služby potřebují čekat na úspěšné
     * připojení před tím, než začnou vytvářet channely. Promise `ready` se
     * resolve-ne v connect() po navázání spojení. Viz komentář v discovery.
     *
     * readyResolve drží referenci na resolve funkci z Promise konstruktoru.
     * Konstruktor Promise se volá synchronně → readyResolve je přiřazen ihned.
     */
    private readyResolve!: () => void;
    readonly ready = new Promise<void>((resolve) => {
        this.readyResolve = resolve;
    });

    /** URL pro připojení (amqp://user:pass@host:port/vhost). Nastaví se v onApplicationBootstrap. */
    private url!: string;

    /** Aktivní AMQP spojení. null = nepřipojeno (před connect nebo po disconnect). */
    private connection: amqp.ChannelModel | null = null;

    /**
     * Sdílený channel pro publish operace.
     * null = connection neexistuje nebo channel spadl (protocol error).
     * Po reconnectu se automaticky vytvoří nový.
     */
    private publishChannel: amqp.Channel | null = null;

    /**
     * Příznak, že probíhá graceful shutdown (onApplicationShutdown byl zavolán).
     * Důvod: close event na connection by jinak spustil reconnect —
     * ale při záměrném vypnutí aplikace reconnect nechceme.
     */
    private shuttingDown = false;

    /**
     * Počítadlo po sobě jdoucích neúspěšných pokusů o reconnect.
     * Resetuje se na 0 při úspěšném připojení.
     * Slouží k výpočtu exponenciálního back-off a k zastavení po MAX_RECONNECT_ATTEMPTS.
     */
    private reconnectAttempts = 0;

    constructor(
        private readonly config: ConfigService,
        private readonly topologyService: RabbitmqTopologyService,
    ) {}

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * NestJS lifecycle hook — zavolá se po inicializaci všech modulů.
     * Načte RABBITMQ_URL z konfigu a naváže první spojení.
     */
    async onApplicationBootstrap(): Promise<void> {
        this.url = this.config.getOrThrow<string>('RABBITMQ_URL');
        await this.connect();
    }

    /**
     * NestJS lifecycle hook — zavolá se při vypínání aplikace (SIGTERM, SIGINT…).
     * Nejdřív nastaví shuttingDown flag, aby close event nespustil reconnect,
     * pak zavře publish channel a connection.
     */
    async onApplicationShutdown(): Promise<void> {
        this.shuttingDown = true;
        await this.publishChannel?.close();
        await this.connection?.close();
        this.logger.log('[RabbitMQ] connection closed');
    }

    // ─── Connection ───────────────────────────────────────────────────────────

    /**
     * Naváže AMQP spojení, aplikuje topologii (exchanges, queues, bindings)
     * a vytvoří publish channel. Volá se:
     *   1. Při startu aplikace (onApplicationBootstrap)
     *   2. Při reconnectu po ztrátě spojení (scheduleReconnect → connect)
     */
    async connect(): Promise<void> {
        this.connection = await amqp.connect(this.url);

        // AMQP connection emituje dva eventy při problémech:
        //
        // 'error' — emituje se PŘED 'close'. Slouží primárně k logování příčiny
        // (heartbeat timeout, protocol error, socket error). Samotný 'error'
        // event NEZAVŘE spojení — to udělá až následný 'close'.
        this.connection.on('error', (err) => {
            this.logger.error('[RabbitMQ] connection error', err);
        });

        // 'close' — emituje se, když je spojení definitivně mrtvé (po error,
        // nebo při normálním zavření). Tady:
        // 1. Vynulujeme reference na connection a publish channel (jsou nepoužitelné).
        // 2. Spustíme reconnect — ale POUZE pokud nejde o záměrný shutdown.
        this.connection.on('close', () => {
            this.publishChannel = null;
            this.connection = null;

            if (!this.shuttingDown) {
                this.logger.warn('[RabbitMQ] connection lost, scheduling reconnect…');
                this.scheduleReconnect();
            }
        });

        // Topologie (exchanges, queues, bindings) musí existovat PŘED vytvořením
        // channelů nebo před tím, než se consumeři pokusí konzumovat z front.
        // applyTopology() je idempotentní — assertExchange/assertQueue nekřičí,
        // pokud entita již existuje se stejným nastavením.
        await this.topologyService.applyTopology();

        // Vytvoříme sdílený publish channel. Jeden stačí — publish je interně
        // serializovaný a amqplib ho zvládá thread-safe pro souběžné volání.
        this.publishChannel = await this.connection.createChannel();

        // Publish channel se může zavřít nezávisle na connection — např. při
        // protocol error (publish do neexistujícího exchange s mandatory=true).
        // Nastavíme ho na null, aby publish() věděl, že nemůže odesílat.
        this.publishChannel.on('close', () => {
            this.publishChannel = null;
        });

        // Úspěšné připojení → reset počítadla pokusů o reconnect.
        this.reconnectAttempts = 0;
        this.logger.log('[RabbitMQ] connected');

        // Resolve-neme deferred promise — služby čekající na `await rabbitmq.ready`
        // (typicky RabbitConsumerDiscovery) mohou pokračovat.
        // Opakované volání resolve() na již resolved promise je no-op — bezpečné.
        this.readyResolve();

        // Notifikujeme posluchače, že se spojení obnovilo.
        // RabbitConsumerDiscovery na tento event reaguje re-registrací consumerů,
        // protože staré consumer channely spadly spolu s původní connection.
        this.emitter.emit('reconnect');
    }

    // ─── Reconnect ────────────────────────────────────────────────────────────

    /**
     * Zaregistruje callback, který se zavolá po každém úspěšném reconnectu.
     *
     * Proč: consumer channely umřou spolu s connection. Po reconnectu je potřeba
     * vytvořit nové channely a znovu zaregistrovat consume callbacky.
     * RabbitConsumerDiscovery tuto metodu volá a předává svůj reregisterAll().
     *
     * Callback je obalený v void + catch, protože EventEmitter.emit() je synchronní
     * a nezvládá async chyby — bez catche by promise rejection crashla proces.
     */
    onReconnect(callback: () => Promise<void>): void {
        this.emitter.on('reconnect', () => {
            void callback().catch((err) => {
                this.logger.error('[RabbitMQ] onReconnect callback failed', err);
            });
        });
    }

    /**
     * Naplánuje reconnect s exponenciálním back-off.
     *
     * Prodleva: BASE_RECONNECT_DELAY_MS * 2^attempt → 1s, 2s, 4s, 8s, 16s…
     * Po MAX_RECONNECT_ATTEMPTS neúspěšných pokusech se vzdá a zaloguje error.
     *
     * Proč setTimeout a ne setInterval:
     * - Každý pokus může trvat různě dlouho (DNS resolve, TCP handshake timeout).
     * - Pokud connect() selže, scheduleReconnect() se zavolá znovu rekurzivně —
     *   tím se zajistí, že další pokus se naplánuje AŽ PO selhání předchozího.
     */
    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            this.logger.error(`[RabbitMQ] giving up after ${MAX_RECONNECT_ATTEMPTS} failed reconnect attempts`);
            return;
        }

        const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;

        this.logger.log(
            `[RabbitMQ] reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`,
        );

        // setTimeout callback je synchronní (vrací void), proto nepoužíváme async.
        // Promise z connect() zpracováváme přes .catch() s explicitním `void`,
        // aby ESLint nehlásil "floating promise".
        setTimeout(() => {
            void this.connect().catch((err) => {
                this.logger.error('[RabbitMQ] reconnect failed', err);
                this.scheduleReconnect();
            });
        }, delay);
    }

    // ─── Publish ──────────────────────────────────────────────────────────────

    /**
     * Publikuje zprávu do RabbitMQ exchange.
     *
     * @returns boolean — backpressure signál z amqplib:
     *   - true = zpráva byla zapsána do interního write bufferu
     *   - false = buffer je plný, měl bys počkat na 'drain' event před dalším publishem
     *   V praxi se false stane jen při extrémním throughputu.
     *
     * @throws Error pokud publish channel neexistuje (connection je mrtvá).
     */
    publish(
        exchange: string,
        routingKey: string,
        payload: RabbitMqMessageEnvelope,
        options: PublishOptions = {},
    ): boolean {
        if (!this.publishChannel) throw new Error('[RabbitMQ] not connected');

        const buffer = Buffer.from(JSON.stringify(payload));

        // channel.publish() je synchronní — serializuje zprávu do AMQP rámce
        // a zapíše do TCP socketu. Nevrací promise.
        return this.publishChannel.publish(exchange, routingKey, buffer, {
            persistent: options.persistent ?? true, // delivery mode 2 = zpráva se ukládá na disk
            messageId: options.messageId,
            contentType: 'application/json',
            headers: options.headers,
            timestamp: Math.floor(Date.now() / 1000), // AMQP timestamp je v sekundách (UNIX epoch)
        });
    }

    // ─── Channel factory ──────────────────────────────────────────────────────

    /**
     * Vytvoří nový AMQP channel.
     *
     * Každý consumer dostane vlastní dedikovaný channel. Důvody:
     * - Channel není thread-safe pro souběžný publish + consume — proto
     *   publish channel a consumer channely jsou striktně oddělené.
     * - Prefetch (QoS) se nastavuje per-channel — sdílený channel by
     *   znamenal sdílený prefetch limit pro všechny consumery.
     * - Pád jednoho channelu (exception při zpracování zprávy) by jinak
     *   shodil i ostatní consumery na stejném channelu.
     *
     * @throws Error pokud connection neexistuje (nepřipojeno nebo po disconnectu).
     */
    createChannel(): Promise<amqp.Channel> {
        if (!this.connection) {
            throw new Error('[RabbitMQ] not connected during createChannel()');
        }

        return this.connection.createChannel();
    }
}
