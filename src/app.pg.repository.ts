import { Inject, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import { join } from 'path';
import * as pgp from 'pg-promise';
import { DB_PROVIDER_TOKEN } from './libs/core/constants';

@Injectable()
export class AppPgRepository {
    private readonly logger = new Logger(AppPgRepository.name);

    constructor(@Inject(DB_PROVIDER_TOKEN) readonly db: pgp.IDatabase<any>) {}

    async bootstrap() {
        const bootstrapPath = join(process.cwd(), 'bootstrap.sql');
        const sql = fs.readFileSync(bootstrapPath, 'utf-8');

        await this.db.none(sql).catch((err) => {
            this.logger.error('Error during database bootstrap:', err);
            throw err;
        });
    }
}
