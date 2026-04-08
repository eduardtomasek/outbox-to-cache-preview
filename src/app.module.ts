import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppPgRepository } from './app.pg.repository';
import { AppService } from './app.service';
import { RabbitmqModule } from './infrastructure/brokers/rabbitmq/rabbitmq.module';
import { AppDbModule } from './infrastructure/databases/app-db/app-db.module';
import { AppRedisModule } from './infrastructure/databases/app-redis/app-redis.module';
import { CardsModule } from './modules/cards/cards.module';
import { ConsumersModule } from './modules/consumers/consumers.module';
import { OutboxEventsModule } from './modules/outbox-events/outbox-events.module';
import { ProjectionsModule } from './modules/projections/projections.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ['.env.local', '.env'],
        }),
        RabbitmqModule,
        AppDbModule,
        AppRedisModule,
        CardsModule,
        ProjectionsModule,
        OutboxEventsModule,
        ConsumersModule,
    ],
    controllers: [AppController],
    providers: [
        // services
        AppService,

        // repositories
        AppPgRepository,
    ],
})
export class AppModule {}
