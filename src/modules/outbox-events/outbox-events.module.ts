import { Module } from '@nestjs/common';
import { RabbitmqModule } from '../../infrastructure/brokers/rabbitmq/rabbitmq.module';
import { AppDbModule } from '../../infrastructure/databases/app-db/app-db.module';
import { OutboxEventsController } from './controllers/outbox-events.controller';
import { OutboxEventsPgRepository } from './repositories/outbox-events.pg.repository';
import { OutboxEventsService } from './services/outbox-events.service';

@Module({
    imports: [AppDbModule, RabbitmqModule],
    controllers: [OutboxEventsController],
    providers: [
        // services
        OutboxEventsService,

        // repositories
        OutboxEventsPgRepository,
    ],
    exports: [OutboxEventsService, OutboxEventsPgRepository],
})
export class OutboxEventsModule {}
