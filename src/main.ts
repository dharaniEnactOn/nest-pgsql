import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { config } from './config/config';  // ← import config

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('OmniLogistics API')
    .setDescription('All-Postgres backend — inventory, telemetry, drivers, orders')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  await app.listen(config.port);
  console.log(`🚀 Server running on http://localhost:${config.port}`);
  console.log(`📖 Swagger at http://localhost:${config.port}/api`);
}
bootstrap();