import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { RabbitMqMessageEnvelope } from '../../../infrastructure/brokers/rabbitmq/interfaces/rabbitmq.interfaces';
import { RabbitmqService } from '../../../infrastructure/brokers/rabbitmq/rabbitmq.service';
import { GAME_EXCHANGE } from '../../../libs/core/constants';
import { OutboxEvent } from '../interfaces/outbox-event.interface';
import { OutboxEventsPgRepository } from '../repositories/outbox-events.pg.repository';

const POLL_INTERVAL_MS = 300;

@Injectable()
export class OutboxEventsService implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(OutboxEventsService.name);
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;

    constructor(
        private readonly outboxEventsRepository: OutboxEventsPgRepository,
        private readonly rabbitmqService: RabbitmqService,
    ) {}

    async onApplicationBootstrap() {
        await this.rabbitmqService.ready;
        this.scheduleNext();
    }

    onApplicationShutdown() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private scheduleNext() {
        this.timer = setTimeout(() => {
            if (this.running) return;
            this.running = true;
            this.sendPendingEvents()
                .catch((error) => this.logger.error('Outbox polling failed', error))
                .finally(() => {
                    this.running = false;
                    this.scheduleNext();
                });
        }, POLL_INTERVAL_MS);
    }

    async sendPendingEvents(batchSize = 1000) {
        const events = await this.outboxEventsRepository.fetchAndLockPendingEvents(batchSize);

        for (const event of events) {
            try {
                const payload: RabbitMqMessageEnvelope<OutboxEvent> = {
                    messageId: String(event.id),
                    type: event.eventType,
                    payload: event,
                };

                this.rabbitmqService.publish(GAME_EXCHANGE, event.eventType, payload, { persistent: true });
            } catch (error) {
                console.error(`Failed to send event ${event.id}:`, error);
                // Optionally, you can implement retry logic here by updating the retryCount and status in the database
            }
        }
    }
}
