import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { RabbitMQProvider } from './rabbitmq.provider';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [OrdersController],
  providers: [OrdersService, RabbitMQProvider],
  exports: [OrdersService],
})
export class OrdersModule {}