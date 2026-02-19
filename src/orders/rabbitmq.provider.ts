import { Provider, Logger } from '@nestjs/common';
import * as amqplib from 'amqplib';
import { config } from '../config/config';  // ← import config

export const RABBITMQ_CONNECTION = 'RABBITMQ_CONNECTION';
export const ORDERS_QUEUE = 'orders_queue';

export const RabbitMQProvider: Provider = {
  provide: RABBITMQ_CONNECTION,
  useFactory: async (): Promise<amqplib.Channel | null> => {
    const logger = new Logger('RabbitMQProvider');
    const url = config.rabbitmqUrl;

    try {
      const connection = await amqplib.connect(url);
      const channel = await connection.createChannel();

      // Durable queue — survives broker restarts
      await channel.assertQueue(ORDERS_QUEUE, { durable: true });

      logger.log(`RabbitMQ connected ✓  queue="${ORDERS_QUEUE}"`);

      // Graceful shutdown
      process.on('beforeExit', async () => {
        await channel.close();
        await connection.close();
      });

      return channel;
    } catch (err) {
      logger.warn(
        `RabbitMQ not available (${(err as Error).message}). ` +
          'Orders will be stored in DB only.',
      );
      return null;
    }
  },
};