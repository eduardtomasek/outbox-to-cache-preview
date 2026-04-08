import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class RabbitmqTopologyService {
    private readonly logger = new Logger(RabbitmqTopologyService.name);

    constructor(private readonly config: ConfigService) {}

    async applyTopology(): Promise<void> {
        const endpoint = this.config.getOrThrow<string>('RABBITMQ_MANAGEMENT_URL');
        const user = this.config.getOrThrow<string>('RABBITMQ_USER');
        const pass = this.config.getOrThrow<string>('RABBITMQ_PASS');

        // process.cwd() je bezpečnější než __dirname — funguje konzistentně v Dockeru
        const definitionsPath = join(process.cwd(), 'rabbitmq-definitions.json');
        const body = await readFile(definitionsPath, 'utf8');

        const credentials = Buffer.from(`${user}:${pass}`).toString('base64');

        const res = await fetch(`${endpoint}/api/definitions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${credentials}`,
            },
            body,
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`[RabbitMQ] Failed to apply topology: ${res.status} – ${text}`);
        }

        this.logger.log('[RabbitMQ] topology applied');
    }
}
