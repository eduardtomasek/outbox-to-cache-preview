import { Module } from '@nestjs/common';
import { AppDbModule } from '../../infrastructure/databases/app-db/app-db.module';
import { AppRedisModule } from '../../infrastructure/databases/app-redis/app-redis.module';
import { CardsController } from './controllers/cards.controller';
import { CardsPgRepository } from './repositories/cards.pg.repository';
import { CardsRedisRepository } from './repositories/cards.redis.repository';
import { ProjectionsCardsPgRepository } from './repositories/projections.cards.pg.repository';
import { CardsService } from './services/cards.service';

@Module({
    imports: [AppDbModule, AppRedisModule],
    controllers: [CardsController],
    providers: [
        // services
        CardsService,

        // repositories
        CardsPgRepository,
        ProjectionsCardsPgRepository,
        CardsRedisRepository,
    ],
    exports: [CardsRedisRepository, ProjectionsCardsPgRepository],
})
export class CardsModule {}
