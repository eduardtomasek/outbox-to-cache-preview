/**
 * @RabbitConsumer() — deklarativní dekorátor pro registraci RabbitMQ consumerů.
 *
 * Umožňuje na libovolnou metodu v libovolném NestJS provideru (service, handler…)
 * pověsit metadata s konfigurací consumera. Při startu aplikace RabbitConsumerDiscovery
 * tyto metadata najde a automaticky metodu zaregistruje jako AMQP consumer callback.
 *
 * Příklad použití:
 *
 *   @RabbitConsumer({ queue: 'game.card.updated', prefetch: 10 })
 *   async handleCardUpdate(payload: CardUpdatedEvent) {
 *       zpracování zprávy — ack/nack řeší discovery automaticky
 *   }
 *
 * JAK TO FUNGUJE POD KAPOTOU:
 * 1. SetMetadata z @nestjs/common připojí k metodě metadata pod klíčem RABBITMQ_CONSUMER_META.
 * 2. Metadata se ukládají přes Reflect.defineMetadata na descriptor metody.
 * 3. RabbitConsumerDiscovery při startu aplikace přes Reflector.get() tato metadata čte
 *    a podle nich registruje AMQP channel + consumer.
 */
import { SetMetadata } from '@nestjs/common';

/**
 * Klíč, pod kterým se metadata ukládají na dekorovanou metodu.
 * Musí být unikátní v rámci celé aplikace — string 'rabbitmq:consumer'
 * slouží jako namespace, aby nedošlo ke kolizi s jinými dekorátory.
 */
export const RABBITMQ_CONSUMER_META = 'rabbitmq:consumer';

export type RabbitmqConsumerOptions = {
    /** Název AMQP fronty, ze které se budou konzumovat zprávy. */
    queue: string;

    /**
     * Maximální počet neack-nutých zpráv, které RabbitMQ pošle tomuto consumeru najednou.
     * Bez prefetche RabbitMQ rozešle všechny zprávy z fronty okamžitě → memory spike.
     * Typická hodnota: 1–50 podle náročnosti zpracování.
     */
    prefetch?: number;

    batch?: {
        size: number; // kolik zpráv nasbírat před zavoláním handleru
        timeoutMs: number; // max čekání — flush i s neúplným batchem
    };
};

/**
 * Dekorátor metody. Vrací výsledek SetMetadata(), což je standardní NestJS
 * method decorator — přiřadí options jako metadata pod klíčem RABBITMQ_CONSUMER_META.
 */
export const RabbitConsumer = (options: RabbitmqConsumerOptions) => SetMetadata(RABBITMQ_CONSUMER_META, options);
