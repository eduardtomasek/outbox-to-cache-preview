import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('app')
@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Get()
    getHello(): string {
        return this.appService.getHello();
    }

    @Get('favicon.ico')
    @Header('Content-Type', 'image/svg+xml')
    getFavicon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="red" />
            <text x="50" y="55" font-family="Arial" font-size="40" text-anchor="middle" fill="white">O</text>
            </svg>
        `.trim();
    }
}
