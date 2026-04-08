import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppPgRepository } from './app.pg.repository';

@Injectable()
export class AppService implements OnModuleInit {
    private readonly logger = new Logger(AppService.name);

    constructor(
        private readonly appPgRepository: AppPgRepository,
        private readonly configService: ConfigService,
    ) {}

    async onModuleInit() {
        const bootstrapDb = this.configService.get<string>('BOOTSTRAP_DB');

        if (bootstrapDb === 'true') {
            this.logger.log('BOOTSTRAP_DB is true, bootstrapping database...');
            await this.appPgRepository.bootstrap();
        } else {
            this.logger.log('BOOTSTRAP_DB is false, skipping database bootstrap.');
        }
    }

    getHello(): string {
        return 'Hello World!';
    }
}
