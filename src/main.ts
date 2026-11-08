import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { serveUploadsFrom, uploadRoot } from './common/storage/serve-uploads';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const apiPrefix = config.get<string>('API_PREFIX') ?? 'api/v2';
  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowAllOrigins = corsOrigins.length === 0 || corsOrigins.includes('*');

  app.use(helmet());
  app.enableCors({
    origin: allowAllOrigins ? '*' : corsOrigins,
    credentials: !allowAllOrigins,
  });
  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );
  app.enableShutdownHooks();

  const uploads = uploadRoot(config.get<string>('UPLOAD_DIR'));
  serveUploadsFrom(app, uploads);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Play Together API')
    .setDescription(
      'Play Together v2 - hire-a-gamer marketplace. All errors use RFC 7807 application/problem+json responses.',
    )
    .setVersion('2.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig), {
    useGlobalPrefix: false,
    swaggerOptions: { persistAuthorization: true },
  });

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`API ready at http://localhost:${port}/${apiPrefix}`);
  logger.log(`OpenAPI docs at http://localhost:${port}/docs`);
}

bootstrap().catch((error: unknown) => {
  console.error('Application failed to start:', error);
  process.exitCode = 1;
});
