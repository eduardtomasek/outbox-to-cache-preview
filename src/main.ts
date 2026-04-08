import { ClassSerializerInterceptor } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import basicAuth from 'express-basic-auth';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.enableCors({ origin: '*' });

    app.use(helmet());

    app.use(compression());

    app.useGlobalInterceptors(
        new ClassSerializerInterceptor(app.get(Reflector), {
            excludeExtraneousValues: true, // respektuje @Expose
            enableImplicitConversion: true,
        }),
    );

    const config = new DocumentBuilder()
        .setTitle('Outbox To Cache API')
        .setDescription('API documentation for Outbox To Cache')
        .setVersion('1.0')
        .build();

    const document = SwaggerModule.createDocument(app, config);

    const apiDocUser = process.env.API_DOC_USER;
    const apiDocPass = process.env.API_DOC_PASS;

    if (!apiDocUser || !apiDocPass) {
        throw new Error('API_DOC_USER and API_DOC_PASS environment variables must be defined');
    }

    app.use(
        '/api',
        basicAuth({
            users: { [apiDocUser]: apiDocPass },
            challenge: true,
        }),
    );

    SwaggerModule.setup('api', app, document, {
        customSiteTitle: 'Outbox To Cache API Docs',
        // customfavIcon: '/favicon.ico',
        swaggerOptions: {
            tagsSorter: 'alpha',
            operationsSorter: 'alpha',
            defaultModelsExpandDepth: -1,
            docExpansion: 'none',
        },
    });

    await app.listen(process.env.PORT ?? 3060);
}

void bootstrap();
