export interface RedisConnectionConfig {
    url: string;
    tls: boolean;
}

export function redisConnection(): RedisConnectionConfig {
    const host = process.env.REDIS_HOST;
    const port = process.env.REDIS_PORT ?? '6380';
    const password = process.env.REDIS_PASSWORD;

    if (!host) {
        throw new Error('REDIS_HOST is not defined');
    }

    // výchozí chování:
    // - produkce = TLS
    // - lokál = bez TLS
    const tls =
        process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true' || process.env.NODE_ENV === 'production';

    const protocol = tls ? 'rediss' : 'redis';
    const authPart = password ? `:${password}@` : '';
    const url = `${protocol}://${authPart}${host}:${port}`;

    return { url, tls };
}
