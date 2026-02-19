import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import * as amqplib from 'amqplib';
import { DatabaseService } from '../database/database.service';
import { RABBITMQ_CONNECTION, ORDERS_QUEUE } from './rabbitmq.provider';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

export type OrderStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

export interface Order {
  id: number;
  customer_id: string;
  driver_id: string;
  inventory_id: string;
  quantity: number;
  status: OrderStatus;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly database: DatabaseService,
    @Inject(RABBITMQ_CONNECTION) private readonly channel: amqplib.Channel | null,
  ) { }

  // ─────────────────────────────────────────────────────────────
  // CREATE — persist to DB then publish to RabbitMQ
  // ─────────────────────────────────────────────────────────────
  async create(dto: CreateOrderDto): Promise<Order> {
    // 1. Persist order in Postgres (source of truth)
    const [order] = await sql<Order>`
      INSERT INTO orders (customer_id, driver_id, inventory_id, quantity, status, metadata)
      VALUES (
        ${dto.customerId},
        ${dto.driverId},
        ${dto.inventoryId},
        ${dto.quantity},
        'pending',
        ${JSON.stringify(dto.metadata ?? {})}::jsonb
      )
      RETURNING *
    `.execute(this.database.db).then((r) => r.rows);

    // 2. Publish to RabbitMQ (fire-and-forget, non-blocking)
    const published = this.publishToQueue(order);

    if (published) {
      // Mark as queued so consumers know it's in the broker
      const [updated] = await sql<Order>`
        UPDATE orders SET status = 'queued', updated_at = NOW()
        WHERE id = ${order.id}
        RETURNING *
      `.execute(this.database.db).then((r) => r.rows);

      this.logger.log(`Order #${order.id} → RabbitMQ "${ORDERS_QUEUE}" ✓`);
      return updated;
    }

    this.logger.warn(`Order #${order.id} saved to DB only (RabbitMQ unavailable)`);
    return order;
  }

  // ─────────────────────────────────────────────────────────────
  // READ
  // ─────────────────────────────────────────────────────────────
  async findAll(status?: OrderStatus): Promise<Order[]> {
    if (status) {
      return sql<Order>`
        SELECT * FROM orders WHERE status = ${status} ORDER BY created_at DESC
      `.execute(this.database.db).then((r) => r.rows);
    }
    return sql<Order>`
      SELECT * FROM orders ORDER BY created_at DESC
    `.execute(this.database.db).then((r) => r.rows);
  }

  async findOne(id: number): Promise<Order> {
    const [order] = await sql<Order>`
      SELECT * FROM orders WHERE id = ${id}
    `.execute(this.database.db).then((r) => r.rows);

    if (!order) throw new NotFoundException(`Order #${id} not found`);
    return order;
  }

  // ─────────────────────────────────────────────────────────────
  // UPDATE
  // ─────────────────────────────────────────────────────────────
  async update(id: number, dto: UpdateOrderDto): Promise<Order> {
    await this.findOne(id); // 404 guard

    const fields: string[] = [];
    const values: unknown[] = [];

    if (dto.customerId !== undefined) { fields.push('customer_id'); values.push(dto.customerId); }
    if (dto.driverId !== undefined)   { fields.push('driver_id');   values.push(dto.driverId); }
    if (dto.inventoryId !== undefined){ fields.push('inventory_id');values.push(dto.inventoryId); }
    if (dto.quantity !== undefined)   { fields.push('quantity');    values.push(dto.quantity); }
    if (dto.metadata !== undefined)   { fields.push('metadata');    values.push(JSON.stringify(dto.metadata)); }

    if (fields.length === 0) return this.findOne(id);

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const [updated] = await sql<Order>`
      UPDATE orders SET ${sql.raw(setClauses + `, updated_at = NOW()`)}
      WHERE id = ${id}
      RETURNING *
    `.execute(this.database.db).then((r) => r.rows);

    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // STATUS TRANSITION  (explicit endpoint for worker callbacks)
  // ─────────────────────────────────────────────────────────────
  async updateStatus(id: number, status: OrderStatus): Promise<Order> {
    await this.findOne(id);
    const [updated] = await sql<Order>`
      UPDATE orders SET status = ${status}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `.execute(this.database.db).then((r) => r.rows);
    return updated;
  }

  // ─────────────────────────────────────────────────────────────
  // DELETE
  // ─────────────────────────────────────────────────────────────
  async remove(id: number): Promise<{ deleted: boolean }> {
    await this.findOne(id);
    await sql`DELETE FROM orders WHERE id = ${id}`.execute(this.database.db);
    return { deleted: true };
  }

  // ─────────────────────────────────────────────────────────────
  // QUEUE STATS  (how many messages are sitting in RabbitMQ)
  // ─────────────────────────────────────────────────────────────
  async queueStats(): Promise<{ queue: string; messageCount: number; consumerCount: number } | null> {
    if (!this.channel) return null;
    const q = await this.channel.checkQueue(ORDERS_QUEUE);
    return {
      queue: q.queue,
      messageCount: q.messageCount,
      consumerCount: q.consumerCount,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────
  private publishToQueue(order: Order): boolean {
    if (!this.channel) return false;

    try {
      const payload = Buffer.from(
        JSON.stringify({
          orderId: order.id,
          customerId: order.customer_id,
          driverId: order.driver_id,
          inventoryId: order.inventory_id,
          quantity: order.quantity,
          metadata: order.metadata,
          publishedAt: new Date().toISOString(),
        }),
      );

      return this.channel.sendToQueue(ORDERS_QUEUE, payload, {
        persistent: true,           // survives broker restart
        contentType: 'application/json',
        messageId: String(order.id),
      });
    } catch (err) {
      this.logger.error('Failed to publish order to RabbitMQ', (err as Error).stack);
      return false;
    }
  }
}