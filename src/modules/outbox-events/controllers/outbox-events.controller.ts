import { Controller, Post } from '@nestjs/common';
import { OutboxEventsService } from '../services/outbox-events.service';

@Controller('outbox-events')
export class OutboxEventsController {
    constructor(private readonly outboxEventsService: OutboxEventsService) {}

    @Post('send-pending-outbox-events') // Endpoint pro spuštění zpracování outbox událostí
    async sendPendingOutboxEvents() {
        await this.outboxEventsService.sendPendingEvents();
    }
}
