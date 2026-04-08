import { Injectable, Logger } from '@nestjs/common';
import { UpdateStrengthDefensePostRequestDto } from '../dto/cards-update-strength-defense.post.dto';
import { CardsPgRepository } from '../repositories/cards.pg.repository';
import { CardsRedisRepository } from '../repositories/cards.redis.repository';
import { ProjectionsCardsPgRepository } from '../repositories/projections.cards.pg.repository';

@Injectable()
export class CardsService {
    private readonly logger = new Logger(CardsService.name);

    constructor(
        private readonly cardsPgRepository: CardsPgRepository,
        private readonly projectionsCardsPgRepository: ProjectionsCardsPgRepository,
        private readonly cardsRedisRepository: CardsRedisRepository,
    ) {}

    async updateStrengthDefense(data: UpdateStrengthDefensePostRequestDto) {
        const { cardUUID, strength, defense } = data;

        if (strength !== undefined) {
            await this.cardsPgRepository.updateStrength(cardUUID, strength);
        }

        if (defense !== undefined) {
            await this.cardsPgRepository.updateDefense(cardUUID, defense);
        }
    }

    async findCardOverview(cardUUID: string) {
        const cachedOverview = await this.cardsRedisRepository.findCardOverviewByUUID(cardUUID);

        if (cachedOverview) {
            this.logger.debug(`Cache hit for card overview with UUID ${cardUUID}`);
            return cachedOverview;
        }

        this.logger.debug(`Cache miss for card overview with UUID ${cardUUID}. Fetching from database.`);
        return this.projectionsCardsPgRepository.findCardOverviewByUUID(cardUUID);
    }

    async putAllCardsIntoOutbox() {
        await this.cardsPgRepository.putAllCardsIntoOutbox();
    }
}
