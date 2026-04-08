import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { CardOverview } from '../interfaces/card-overview.interface';

@Injectable()
export class CardsRedisRepository {
    private readonly logger = new Logger(CardsRedisRepository.name);

    constructor(@Inject('REDIS_CLIENT') private readonly redisClient: RedisClientType) {}

    async findCardOverviewByUUID(cardUUID: string) {
        const cacheKey = `card_overview:${cardUUID}`;
        const cachedData = await this.redisClient.get(cacheKey);

        if (!cachedData) {
            return null;
        }

        try {
            return JSON.parse(cachedData) as CardOverview;
        } catch (error) {
            this.logger.error(`Failed to parse cached card overview for UUID ${cardUUID}: ${(error as Error).message}`);
            return null;
        }
    }

    async cacheCardOverview(cardOverview: CardOverview) {
        const cacheKey = `card_overview:${cardOverview.cardUUID}`;

        try {
            await this.redisClient.set(cacheKey, JSON.stringify(cardOverview));
        } catch (error) {
            this.logger.error(
                `Failed to cache card overview for UUID ${cardOverview.cardUUID}: ${(error as Error).message}`,
            );
        }
    }
}
