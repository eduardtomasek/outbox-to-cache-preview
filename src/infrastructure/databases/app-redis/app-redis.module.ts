// redis.module.ts
import { Global, Logger, Module } from '@nestjs/common';
import { createClient } from 'redis';
import { redisConnection } from '../../../libs/shared-utils/functions/redis-connection-url';

// NestJS Logger instance for structured and consistent logging
const logger = new Logger('AppRedisModule');

/**
 * Wraps a promise with a timeout mechanism.
 * If the promise does not resolve within the specified time, it rejects with a timeout error.
 *
 * @param p - The promise to wrap.
 * @param ms - Timeout duration in milliseconds.
 * @param label - A label to identify the operation in the error message.
 * @returns A promise that either resolves or rejects with a timeout error.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);
}

@Global()
@Module({
    providers: [
        {
            provide: 'REDIS_CLIENT',
            useFactory: async () => {
                // Retrieve Redis connection URL and TLS settings from environment variables
                const { url } = redisConnection();
                logger.log(`[INIT][REDIS_CLIENT] creating client: ${url}`);

                // Create a Redis client with custom socket options
                const client = createClient({
                    url,
                    socket: {
                        connectTimeout: 5000, // Timeout for establishing a connection
                        reconnectStrategy: (retries) => {
                            if (retries > 5) {
                                return new Error('Max retries reached'); // Fail after 5 retries
                            }
                            return Math.min(retries * 100, 3000); // Exponential backoff up to 3 seconds
                        },
                    },
                });

                client.on('error', (e) => logger.error('[INIT][REDIS_CLIENT] error', e));
                client.on('connect', () => logger.log('[INIT][REDIS_CLIENT] socket connected'));
                client.on('ready', () => logger.log('[INIT][REDIS_CLIENT] ready'));

                logger.log('[INIT][REDIS_CLIENT] connecting...');
                // Attempt to connect to Redis with a timeout
                await withTimeout(client.connect(), 7000, 'redis.connect');
                logger.log('[INIT][REDIS_CLIENT] connected OK');

                return client; // Return the connected Redis client instance
            },
        },
    ],
    exports: ['REDIS_CLIENT'],
})
export class AppRedisModule {}
