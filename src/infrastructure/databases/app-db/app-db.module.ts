import { Module } from '@nestjs/common';
import { appDbProvider } from './app-db.provider';

@Module({
    controllers: [],
    providers: [appDbProvider],
    exports: [appDbProvider],
})
export class AppDbModule {}
