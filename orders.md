# Orders Module — Implementation Notes

> **Location:** `src/orders/`
> **Last updated:** February 2026
> **Replaces:** PGMQ (unavailable in current deployment)
> **Queue broker:** RabbitMQ (`amqplib`)
> **DB source of truth:** `orders` table (PostgreSQL)

---

## Why RabbitMQ instead of PGMQ?

The running database does **not** include the `pgmq` extension:

```
pg_buffercache | 1.4
pg_cron        | 1.6
pg_trgm        | 1.6
plpgsql        | 1.0
postgis        | 3.6.2
timescaledb    | 2.24.0
vector         | 0.8.1
vectorscale    | 0.9.0
```

Rather than an in-DB queue, the orders module uses **RabbitMQ** — a battle-tested AMQP broker that provides durable queues, consumer acknowledgements, and dead-letter routing without requiring a custom Postgres build.

### Design Principles

- **PostgreSQL is the source of truth.** Every order is written to the `orders` table *before* anything is published to the broker.
- **RabbitMQ is the delivery mechanism.** If the broker is down, the order still exists in the DB with `status = 'pending'` and can be requeued on recovery.
- **Graceful degradation.** `RabbitMQProvider` catches connection failures and returns `null`. The service logs a warning but never throws — orders keep saving.

---

## Architecture

```
POST /orders
    │
    ▼
┌─────────────────────┐
│  orders table (PG)  │  ← INSERT, status = 'pending'
└─────────────────────┘
    │
    ▼ channel.sendToQueue()
┌─────────────────────────────┐
│  RabbitMQ: orders_queue     │  ← durable, persistent messages
└─────────────────────────────┘
    │
    ▼ consumer (worker / microservice)
  process order → PATCH /orders/:id/status?value=completed
```

---

## Database Schema

Defined in `migrations/002_orders_table.sql`:

```sql
CREATE TABLE IF NOT EXISTS orders (
    id           BIGSERIAL    PRIMARY KEY,
    customer_id  TEXT         NOT NULL,
    driver_id    TEXT         NOT NULL,
    inventory_id TEXT         NOT NULL,
    quantity     INTEGER      NOT NULL CHECK (quantity > 0),
    status       TEXT         NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','queued','processing','completed','failed')),
    metadata     JSONB        NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Indexes

| Index | Columns | Purpose |
|:---|:---|:---|
| `idx_orders_status` | `(status, created_at DESC)` | Worker polling — find pending/queued orders fast |
| `idx_orders_customer` | `(customer_id, created_at DESC)` | Customer order history |
| `idx_orders_driver` | `(driver_id, status)` | Driver workload dashboard |

A `plpgsql` trigger (`trg_orders_updated_at`) auto-updates `updated_at` on every row change — no application-level bookkeeping needed.

---

## File Structure

```
src/orders/
├── orders.module.ts          # NestJS module — imports DatabaseModule, registers RabbitMQProvider
├── orders.controller.ts      # REST endpoints + Swagger decorators
├── orders.service.ts         # DB persistence (Kysely sql``) + RabbitMQ publishing
├── rabbitmq.provider.ts      # amqplib connection factory — graceful degradation on failure
└── dto/
    ├── create-order.dto.ts   # customerId, driverId, inventoryId, quantity, metadata
    └── update-order.dto.ts   # PartialType of CreateOrderDto
```

---

## Environment Variables

| Variable | Default | Description |
|:---|:---|:---|
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | Full AMQP connection string |

Add to your `.env`:
```env
RABBITMQ_URL=amqp://guest:guest@localhost:5672
```

---

## Running RabbitMQ Locally

```bash
docker run -d \
  --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:3-management
```

Management UI → http://localhost:15672 (guest / guest)

Or add to `docker-compose.yml`:

```yaml
rabbitmq:
  image: rabbitmq:3-management
  ports:
    - "5672:5672"
    - "15672:15672"
  healthcheck:
    test: ["CMD", "rabbitmq-diagnostics", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
```

---

## API Endpoints

| Method | Path | Description |
|:---|:---|:---|
| `POST` | `/orders` | Create order → persists to DB → publishes to RabbitMQ |
| `GET` | `/orders` | List orders (optional `?status=` filter) |
| `GET` | `/orders/queue-stats` | Live RabbitMQ message & consumer count |
| `GET` | `/orders/:id` | Fetch a single order |
| `PATCH` | `/orders/:id` | Update order fields |
| `PATCH` | `/orders/:id/status?value=` | Transition order status (worker callback) |
| `DELETE` | `/orders/:id` | Delete an order |

### Order Status Lifecycle

```
pending → queued → processing → completed
                             ↘ failed
```

| Status | Set by |
|:---|:---|
| `pending` | System on INSERT (before RabbitMQ publish attempt) |
| `queued` | System after successful `channel.sendToQueue()` |
| `processing` | Consumer worker via `PATCH /orders/:id/status?value=processing` |
| `completed` | Consumer worker via `PATCH /orders/:id/status?value=completed` |
| `failed` | Consumer worker or system on error |

---

## Message Payload (RabbitMQ)

Each message published to `orders_queue` is a persistent JSON buffer:

```json
{
  "orderId": 42,
  "customerId": "customer-uuid-123",
  "driverId": "driver-uuid-456",
  "inventoryId": "item-uuid-789",
  "quantity": 3,
  "metadata": { "deliveryAddress": "123 Main St" },
  "publishedAt": "2026-02-19T10:00:00.000Z"
}
```

Messages use `{ persistent: true }` so they survive broker restarts.
docker stop rabbitmq

curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-uuid-offline-test",
    "driverId": "driver-uuid-001",
    "inventoryId": "item-uuid-001",
    "quantity": 1,
    "metadata": { "note": "RabbitMQ was down when this was created" }
  }'
# → status: "pending"  (saved to DB, broker skipped)

docker start rabbitmq

---

## Migration from PGMQ (if added later)

If `pgmq` becomes available in the future, migration path:

1. Add `pgmq` to `migrations/001_init_extensions.sql`
2. Replace `rabbitmq.provider.ts` with a PGMQ service using `pgmq.send('orders_queue', payload)`
3. Remove `amqplib` dependency
4. Remove RabbitMQ from `docker-compose.yml`

The `orders` table and all API endpoints remain unchanged — only the transport layer swaps.