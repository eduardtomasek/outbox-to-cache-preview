// src/rabbitmq/interfaces/rabbitmq-message.interface.ts

/**
 * Obecný tvar zprávy, kterou budeme posílat do RabbitMQ.
 *
 * Proč mít společný envelope:
 * - můžeš snadno logovat messageId / type
 * - consumer ví, co očekávat
 * - do budoucna můžeš přidat metadata bez rozbíjení payloadu
 */
export interface RabbitMqMessageEnvelope<TPayload = unknown> {
    /**
     * Jedinečný identifikátor zprávy.
     * Hodí se pro idempotenci, logování, tracing.
     */
    messageId: string;

    /**
     * Logický typ zprávy.
     * Např. "user.created", "projection.rebuild", "ledger.entry.created".
     */
    type: string;

    /**
     * Vlastní business data.
     */
    payload: TPayload;

    /**
     * Volitelná metadata.
     * Např. correlationId, source service, createdAt atd.
     */
    meta?: Record<string, unknown>;
}

/**
 * Pomocný typ pro batch consumer:
 * drží jak raw RabbitMQ message, tak již naparsovaný obsah.
 *
 * Proč:
 * - při zpracování dávky potřebuješ raw message pro ack/nack
 * - zároveň nechceš JSON.parse volat znovu
 */
export interface BufferedRabbitMqMessage<TPayload = unknown> {
    raw: import('amqplib').ConsumeMessage;
    parsed: RabbitMqMessageEnvelope<TPayload>;
}
