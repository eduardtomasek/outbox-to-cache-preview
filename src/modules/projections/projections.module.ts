import { Module } from '@nestjs/common';
import { AppDbModule } from '../../infrastructure/databases/app-db/app-db.module';
import { CardsModule } from '../cards/cards.module';
import { CardOverviewProjectionsPgRepository } from './repositories/card-overview.projections.pg.repository';
import { ProjectionsService } from './services/projections.service';

@Module({
    imports: [AppDbModule, CardsModule],
    controllers: [],
    providers: [
        // services
        ProjectionsService,

        // repositories
        CardOverviewProjectionsPgRepository,
    ],
    exports: [ProjectionsService],
})
export class ProjectionsModule {}
