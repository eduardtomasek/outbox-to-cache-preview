import { Injectable } from '@nestjs/common';
import { CardsRedisRepository } from '../../cards/repositories/cards.redis.repository';
import { ProjectionsCardsPgRepository } from '../../cards/repositories/projections.cards.pg.repository';
import { CardOverviewProjectionsPgRepository } from '../repositories/card-overview.projections.pg.repository';

@Injectable()
export class ProjectionsService {
    constructor(
        private readonly cardOverviewProjectionsPgRepository: CardOverviewProjectionsPgRepository,
        private readonly cardsRedisRepository: CardsRedisRepository,
        private readonly projectionsCardsPgRepository: ProjectionsCardsPgRepository,
    ) {}

    async projectCardOverview(cardUUID: string) {
        await this.cardOverviewProjectionsPgRepository.projectCardOverview(cardUUID);

        const data = await this.projectionsCardsPgRepository.findCardOverviewByUUID(cardUUID);

        if (data) {
            await this.cardsRedisRepository.cacheCardOverview(data);
        }
    }
}
