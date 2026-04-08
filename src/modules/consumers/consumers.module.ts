import { Module } from '@nestjs/common';
import { OutboxEventsModule } from '../outbox-events/outbox-events.module';
import { ProjectionsModule } from '../projections/projections.module';
import { GameCardUpdatedConsumersService } from './services/game-card-updated.consumers.service';

@Module({
    imports: [ProjectionsModule, OutboxEventsModule],
    providers: [GameCardUpdatedConsumersService],
})
export class ConsumersModule {}
