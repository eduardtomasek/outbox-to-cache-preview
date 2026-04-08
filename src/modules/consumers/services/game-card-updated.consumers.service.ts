import { Injectable, Logger } from '@nestjs/common';
import { RabbitConsumer } from '../../../infrastructure/brokers/rabbitmq/decorators/rabbitmq-consumer.decorator';
import type { BufferedRabbitMqMessage } from '../../../infrastructure/brokers/rabbitmq/interfaces/rabbitmq.interfaces';
import { UpdateCardOutboxPayload } from '../../cards/interfaces/update-card-outbox-payload.interface';
import { OutboxEvent } from '../../outbox-events/interfaces/outbox-event.interface';
import { OutboxEventsPgRepository } from '../../outbox-events/repositories/outbox-events.pg.repository';
import { ProjectionsService } from '../../projections/services/projections.service';

@Injectable()
export class GameCardUpdatedConsumersService {
    private readonly logger = new Logger(GameCardUpdatedConsumersService.name);

    constructor(
        private readonly projectionsService: ProjectionsService,
        private readonly outboxEventsRepository: OutboxEventsPgRepository,
    ) {}

    @RabbitConsumer({ queue: 'q.game.card-updated', prefetch: 50, batch: { size: 500, timeoutMs: 500 } })
    async consume(messages: BufferedRabbitMqMessage<OutboxEvent>[]) {
        // console.log(messages);
        // console.log(
        //     'Received message:',
        //     messages.map((item) => item.parsed),
        // );

        for (const message of messages) {
            const { parsed } = message;

            const payload = parsed.payload;

            try {
                const cardUUID = (payload.payload as UpdateCardOutboxPayload).cardUUID;

                await this.projectionsService.projectCardOverview(cardUUID);

                // Mark the event as sent after successful processing
                await this.outboxEventsRepository.setEventSent(payload.id);

                this.logger.debug(
                    `[q.game.card-updated] Successfully processed event ${payload.id} for card UUID ${cardUUID}`,
                );
            } catch (error) {
                this.logger.error('Error processing game.card.updated event:', error);

                await this.outboxEventsRepository.resetStatusToPending(payload.id);

                await this.outboxEventsRepository.incrementRetryCount(payload.id);

                if (payload.retryCount + 1 >= 5) {
                    this.logger.error(`Event ${payload.id} has reached maximum retry attempts. Marking as failed.`);
                    await this.outboxEventsRepository.setEventFailed(payload.id);
                }
            }
        }
    }
}
