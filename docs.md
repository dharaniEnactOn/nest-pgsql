# OmniLogistics 🚚

**The All-Postgres Backend.** A production-grade NestJS API that replaces Elasticsearch, Pinecone, Kafka, Redis, InfluxDB, and MongoDB with a single PostgreSQL database using advanced extensions.

> **Philosophy:** *"It's 2026, Just Use Postgres."*

---

## 🧩 Active PostgreSQL Extensions

The following extensions are confirmed active in the production database:

| Extension | Version | Role in This Project |
|:---|:---|:---|
| `vector` | 0.8.1 | HNSW vector index for semantic similarity search |
| `vectorscale` | 0.9.0 | StreamingDiskANN index for high-throughput ANN queries |
| `timescaledb` | 2.24.0 | Hypertable partitioning, `time_bucket()` aggregation, compression & retention policies |
| `postgis` | 3.6.2 | `GEOGRAPHY(POINT)` columns, `ST_DWithin`, `ST_Distance`, `ST_AsGeoJSON`, GIST spatial indexing |
| `pg_trgm` | 1.6 | Trigram `similarity()` for fuzzy/typo-tolerant name and keyword search |
| `pg_cron` | 1.6 | Scheduled background jobs (cache purge, TimescaleDB policy hooks) |
| `pg_buffercache` | 1.4 | Buffer pool observability for cache hit-rate diagnostics |
| `plpgsql` | 1.0 | Procedural triggers (e.g., `updated_at` auto-update on orders) |

```sql
-- Verify active extensions in your deployment
SELECT extname, extversion FROM pg_extension ORDER BY extname;
```

---

## 📖 The Philosophy

Modern backends suffer from **database sprawl** — a different service for every problem:

- Search → Elasticsearch
- Vectors → Pinecone
- Time-series → InfluxDB
- Queues → Kafka / RabbitMQ
- Caching → Redis
- Flexible schema → MongoDB
- Geospatial → dedicated GIS

OmniLogistics proves this is unnecessary. Every one of those concerns is handled by PostgreSQL with the right extensions — **one connection string, one backup strategy, one security model**.

---

## 🛠 Tech Stack

| Layer | Technology |
|:---|:---|
| Runtime | Node.js 18+ |
| Framework | NestJS |
| Language | TypeScript |
| Database | PostgreSQL 16 |
| Query Builder | Kysely (type-safe SQL, fully typed via `db.d.ts`) |
| API Documentation | Swagger / OpenAPI 3.0 |
| Infrastructure | Docker & Docker Compose |
| Message Broker | RabbitMQ (`amqplib`) — see Orders module note |

---

## 🗄 Database Schema

### `inventory`
Full-text, vector, and trigram search over product records.

```sql
CREATE TABLE inventory (
    id          SERIAL        PRIMARY KEY,
    name        TEXT          NOT NULL,
    description TEXT,
    metadata    JSONB         DEFAULT '{}',   -- flexible schema (replaces MongoDB)
    embedding   vector(1536),                 -- pgvector: 1536-dim OpenAI embeddings
    created_at  TIMESTAMPTZ   DEFAULT NOW()
);
```

**Indexes:**

| Index | Type | Extension | Purpose |
|:---|:---|:---|:---|
| `idx_inventory_bm25` | `bm25` | `pg_textsearch` (ParadeDB) | BM25 full-text ranking (primary path) |
| `idx_inventory_fts` | `GIN tsvector` | built-in | Full-text fallback when BM25 unavailable |
| `idx_inventory_vector` | `HNSW` | `vector` / `vectorscale` | Cosine-similarity ANN vector search |
| `idx_inventory_trgm` | `GIN gin_trgm_ops` | `pg_trgm` | Fuzzy / typo-tolerant keyword search |

---

### `vehicle_telemetry`
TimescaleDB hypertable for IoT sensor data.

```sql
CREATE TABLE vehicle_telemetry (
    time          TIMESTAMPTZ      NOT NULL,
    vehicle_id    TEXT             NOT NULL,
    speed         DOUBLE PRECISION,
    battery_level DOUBLE PRECISION,
    temperature   DOUBLE PRECISION,
    location      GEOGRAPHY(POINT, 4326)   -- live GPS via PostGIS
);
-- Partitioned by time via TimescaleDB
-- Compressed after 7 days (segmented by vehicle_id)
-- Retention policy managed by TimescaleDB + pg_cron
```

**Indexes:** `idx_telemetry_time (time DESC)`, `idx_telemetry_vehicle (vehicle_id, time DESC)`

---

### `drivers`
Geospatial driver registry with PostGIS location tracking.

```sql
CREATE TABLE drivers (
    id       SERIAL             PRIMARY KEY,
    name     TEXT               NOT NULL,
    location GEOGRAPHY(POINT, 4326),
    status   TEXT               DEFAULT 'offline'  -- online | offline | busy
);
-- GIST spatial index on location for ST_DWithin proximity queries
```

---

### `orders`
Order lifecycle with automatic `updated_at` tracking via `plpgsql` trigger.

```sql
CREATE TABLE orders (
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
-- plpgsql trigger: trg_orders_updated_at auto-updates updated_at on every change
```

**Indexes:** `idx_orders_status (status, created_at DESC)`, `idx_orders_customer`, `idx_orders_driver`

---

### `route_cache`
Redis replacement using PostgreSQL `UNLOGGED` tables.

```sql
CREATE UNLOGGED TABLE route_cache (
    route_id   TEXT        PRIMARY KEY,
    data       JSONB,
    expires_at TIMESTAMPTZ
);
-- pg_cron job: purge-route-cache runs every hour (0 * * * *)
-- DELETE FROM route_cache WHERE expires_at < NOW()
```

---

## 📂 Project Structure

```text
src/
├── database/
│   ├── database.module.ts       # Kysely pool setup
│   ├── database.service.ts      # DB injection token
│   └── db.d.ts                  # Full type-safe schema (Kysely types)
├── inventory/
│   ├── inventory.controller.ts  # REST endpoints + Swagger
│   ├── inventory.service.ts     # pgvector, pg_trgm, tsvector queries
│   └── dto/
├── telemetry/
│   ├── telemetry.controller.ts  # REST endpoints + Swagger
│   ├── telemetry.service.ts     # TimescaleDB, PostGIS queries
│   └── dto/
├── drivers/
│   ├── drivers.controller.ts    # REST endpoints + Swagger
│   ├── drivers.service.ts       # PostGIS, pg_trgm queries
│   └── dto/
├── orders/
│   ├── orders.controller.ts     # REST endpoints + Swagger
│   ├── orders.service.ts        # RabbitMQ + PostgreSQL source-of-truth
│   ├── rabbitmq.provider.ts     # Graceful-degradation AMQP connection
│   └── dto/
└── app.module.ts
migrations/
├── 001_init_extensions.sql      # All extensions, tables, indexes, seed data
└── 002_orders_table.sql         # Orders table + plpgsql trigger
```

---

## 🔌 Module Technical Reference

### 1. Inventory — Hybrid Search

**Extensions:** `vector` 0.8.1 · `vectorscale` 0.9.0 · `pg_trgm` 1.6 · `plpgsql` (tsvector GIN)

Three parallel search strategies execute simultaneously in a single SQL query:

**Full-text search** uses `tsvector` with `ts_rank` for BM25-style keyword matching. The GIN index on `to_tsvector('english', name || ' ' || description)` makes this sub-millisecond even at millions of rows. An `ILIKE` scan provides a safety net for partial matches.

**Vector search** uses `pgvector`'s HNSW index (`vector_cosine_ops`) for approximate nearest-neighbor semantic similarity. The `embedding` column holds 1536-dimensional OpenAI-compatible vectors. `vectorscale`'s StreamingDiskANN can serve as an alternative index for extremely large corpora.

**Fuzzy search** uses `pg_trgm`'s `similarity()` function with a GIN trigram index (`gin_trgm_ops`) to catch typos and abbreviations without any external service.

**API Endpoints:**

| Method | Path | Description |
|:---|:---|:---|
| `POST` | `/inventory` | Create item (triggers embedding generation) |
| `GET` | `/inventory` | List all items, paginated |
| `GET` | `/inventory/search?q=` | Hybrid full-text + trigram search |
| `GET` | `/inventory/vector-search?q=` | Semantic vector similarity search |
| `GET` | `/inventory/:id` | Fetch single item |
| `PUT` | `/inventory/:id` | Full update |
| `PATCH` | `/inventory/:id` | Partial update |
| `DELETE` | `/inventory/:id` | Delete item |

---

### 2. Telemetry — Time-Series

**Extensions:** `timescaledb` 2.24.0 · `postgis` 3.6.2 · `pg_cron` 1.6

`vehicle_telemetry` is a **TimescaleDB hypertable** partitioned by `time`. TimescaleDB's chunk-exclusion planner makes `ORDER BY time DESC` queries extremely efficient — it only scans the most recent chunk(s) rather than the entire table.

**Compression policy:** Chunks older than 7 days are automatically compressed, segmented by `vehicle_id`. This typically achieves 90–95% storage reduction for float-heavy sensor data.

**`time_bucket()` aggregation** on the `/aggregate` endpoint groups readings into arbitrary intervals (`1 hour`, `15 minutes`, `1 day`) entirely in-database — equivalent to InfluxDB's `GROUP BY time()` or Prometheus `rate()`.

The `location` column uses `GEOGRAPHY(POINT, 4326)`. All reads cast via `ST_AsGeoJSON()::jsonb` to return standards-compliant GeoJSON that mapping libraries consume directly.

`pg_cron` hooks are registered internally by TimescaleDB to drive compression and retention background workers.

**API Endpoints:**

| Method | Path | Description |
|:---|:---|:---|
| `POST` | `/telemetry` | Ingest one sensor reading |
| `GET` | `/telemetry` | List recent readings (paginated, optional `?vehicle_id=`) |
| `GET` | `/telemetry/fleet` | Latest snapshot per vehicle (`?window_hours=24`) |
| `GET` | `/telemetry/stats` | TimescaleDB chunk & compression metadata |
| `GET` | `/telemetry/:vehicle_id/latest` | Most-recent row for one vehicle |
| `GET` | `/telemetry/:vehicle_id/aggregate` | `time_bucket()` averages (`?bucket=1 hour&from=&to=`) |

---

### 3. Drivers — Geospatial

**Extensions:** `postgis` 3.6.2 · `pg_trgm` 1.6

The `location` column is `GEOGRAPHY(POINT, 4326)`. Using the `GEOGRAPHY` type (not `GEOMETRY`) means all distance and proximity calculations (`ST_Distance`, `ST_DWithin`) are automatically performed in metres on a spheroidal Earth model — no manual CRS projections required.

**`ST_DWithin` with GIST index** is used for proximity search. This is always preferred over `WHERE ST_Distance(...) < radius` because `ST_DWithin` can exploit the spatial index; a bare `ST_Distance` comparison cannot. The GIST index prunes the candidate set before exact distance evaluation.

**GPS ping endpoint** (`PATCH /drivers/:id/location`) updates only the `location` column to minimise write amplification at high ping frequencies (hundreds per minute per vehicle fleet).

**`pg_trgm similarity()`** powers the fuzzy driver name search at threshold `0.15` — catches single-character typos and abbreviations that rigid `LIKE` queries miss.

**API Endpoints:**

| Method | Path | Description |
|:---|:---|:---|
| `POST` | `/drivers` | Register a new driver |
| `GET` | `/drivers` | List all drivers (optional `?status=` filter) |
| `GET` | `/drivers/nearby` | `ST_DWithin` proximity search (`?lat=&lon=&radius_m=&status=`) |
| `GET` | `/drivers/search` | `pg_trgm similarity()` fuzzy name search (`?q=`) |
| `GET` | `/drivers/:id` | Fetch single driver |
| `PATCH` | `/drivers/:id` | Update name, status, and/or location |
| `PATCH` | `/drivers/:id/location` | GPS ping — update location only |
| `GET` | `/drivers/distance/:a/:b` | `ST_Distance` geodesic distance between two drivers |
| `DELETE` | `/drivers/:id` | Delete a driver |

---

### 4. Orders — Message Queue

**Extensions used:** `plpgsql` 1.0 (trigger) · `pg_cron` 1.6 (route cache purge)

**Why RabbitMQ instead of pgmq?** The current production database does not include the `pgmq` extension (see active extensions table above). Rather than an in-DB queue, the orders module uses **RabbitMQ** via `amqplib` — a battle-tested AMQP broker providing durable queues, consumer acknowledgements, and dead-letter routing.

**Design principle — PostgreSQL is always the source of truth.** Every order is written to the `orders` table with `status = 'pending'` *before* anything is published to RabbitMQ. If the broker is unavailable, the order is preserved in the database and can be requeued on recovery. The `RabbitMQProvider` catches connection failures and returns `null`; the service logs a warning but never throws.

The `plpgsql` trigger `trg_orders_updated_at` automatically updates `updated_at` on every row change — no application-level bookkeeping required.

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
    ▼ consumer
  PATCH /orders/:id/status?value=completed
```

**API Endpoints:**

| Method | Path | Description |
|:---|:---|:---|
| `POST` | `/orders` | Create order (persists to DB + enqueues to RabbitMQ) |
| `GET` | `/orders` | List orders (optional `?status=&customer_id=&driver_id=`) |
| `GET` | `/orders/:id` | Fetch single order |
| `PATCH` | `/orders/:id/status` | Update order status (`?value=completed`) |

---

### 5. Scheduled Jobs — pg_cron

**Extension:** `pg_cron` 1.6

`pg_cron` manages two categories of scheduled jobs:

**Route cache purge** runs every hour and deletes expired entries from the `UNLOGGED route_cache` table:
```sql
-- Schedule: '0 * * * *'
DELETE FROM route_cache WHERE expires_at < NOW();
```

**TimescaleDB background workers** register their own compression and retention jobs through `pg_cron`'s job infrastructure automatically — no manual cron setup is required for the 7-day compression policy on `vehicle_telemetry`.

Job status can be inspected via:
```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

---

### 6. Cache — pg_buffercache + UNLOGGED Tables

**Extension:** `pg_buffercache` 1.4

Two caching mechanisms are in use:

**Application-layer cache** uses PostgreSQL `UNLOGGED` tables (`route_cache`). Writes to unlogged tables bypass WAL, making them 2–10× faster than regular tables. Data is lost on crash/restart (acceptable for a cache). TTL is enforced by the `pg_cron` purge job.

**Buffer pool observability** via `pg_buffercache` lets operators inspect PostgreSQL's shared buffer cache:
```sql
-- Cache hit rate per relation
SELECT relname,
       COUNT(*) AS buffers_in_cache,
       ROUND(COUNT(*) * 8192 / 1024.0 / 1024.0, 2) AS size_mb
FROM pg_buffercache bc
JOIN pg_class c ON c.relfilenode = bc.relfilenode
WHERE bc.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
GROUP BY relname
ORDER BY buffers_in_cache DESC;
```

The `PgBuffercache` type is fully reflected in `src/database/db.d.ts` for type-safe querying via Kysely.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- `psql` (optional, for debugging)

### 1. Clone & Configure

```bash
git clone https://github.com/your-username/omni-logistics.git
cd omni-logistics
cp .env.example .env
```

**`.env`**
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/omnilogistics
PORT=3000
RABBITMQ_URL=amqp://localhost:5672
```

### 2. Start Infrastructure

```bash
# Start PostgreSQL (TimescaleDB image with PostGIS, pgvector, vectorscale)
docker compose down -v
docker compose build      # Rust compile — takes 5-10 min on first build
docker compose up -d

# Start RabbitMQ (required for Orders module)
docker run -d --name rabbitmq \
  -p 5672:5672 -p 15672:15672 \
  rabbitmq:3-management
```

### 3. Run Migrations

```bash
# Apply schema, extensions, hypertables, indexes, seed data
docker compose exec db psql -U postgres -d omnilogistics \
  -f /docker-entrypoint-initdb.d/001_init_extensions.sql

# Or from the host (if psql is installed)
psql $DATABASE_URL -f migrations/001_init_extensions.sql
psql $DATABASE_URL -f migrations/002_orders_table.sql
```

### 4. Verify Extensions

```bash
docker compose exec db psql -U postgres -d omnilogistics \
  -c "SELECT extname, extversion FROM pg_extension ORDER BY extname;"
```

Expected output:
```
    extname     | extversion
----------------+------------
 pg_buffercache | 1.4
 pg_cron        | 1.6
 pg_trgm        | 1.6
 plpgsql        | 1.0
 postgis        | 3.6.2
 timescaledb    | 2.24.0
 vector         | 0.8.1
 vectorscale    | 0.9.0
```

### 5. Start the API

```bash
npm install
npm run start:dev
```

### 6. Explore

| Interface | URL |
|:---|:---|
| **Swagger UI** | http://localhost:3000/api |
| **Health Check** | http://localhost:3000/health |
| **RabbitMQ UI** | http://localhost:15672 (guest/guest) |

---

## 🧪 Testing the Extensions via Swagger

```
# 1. Inventory — create item (embedding stored as vector(1536))
POST /inventory
{ "name": "Wireless Headphones", "description": "Noise-cancelling, 30hr battery",
  "metadata": { "price": 299.99, "category": "electronics" } }

# 2. Inventory — hybrid search
GET /inventory/search?q=headphones

# 3. Telemetry — ingest IoT reading (PostGIS location + TimescaleDB hypertable)
POST /telemetry
{ "vehicle_id": "v-001", "speed": 65.2, "battery_level": 92.0,
  "location": { "lat": 23.0225, "lon": 72.5714 } }

# 4. Telemetry — time_bucket() aggregation
GET /telemetry/v-001/aggregate?bucket=15 minutes&from=2026-02-19T00:00:00Z

# 5. Telemetry — TimescaleDB chunk stats
GET /telemetry/stats

# 6. Drivers — register with PostGIS location
POST /drivers
{ "name": "Alice Chen", "location": { "lat": 37.7749, "lon": -122.4194 }, "status": "online" }

# 7. Drivers — proximity search (ST_DWithin + GIST index)
GET /drivers/nearby?lat=37.7749&lon=-122.4194&radius_m=3000&status=online

# 8. Drivers — fuzzy name search (pg_trgm)
GET /drivers/search?q=Alic

# 9. Drivers — geodesic distance (ST_Distance on GEOGRAPHY)
GET /drivers/distance/1/2

# 10. Orders — create (writes to DB + RabbitMQ)
POST /orders
{ "customer_id": "cust-1", "driver_id": "drv-1", "inventory_id": "1", "quantity": 2 }
```

---

## 🤝 Why This Architecture

**Simplicity:** One connection string. One backup. One `pg_dump`. One security model.

**Consistency:** No data drift between search index and primary DB — the inventory table *is* the search index.

**AI-Ready:** LLM agents can fork a single Postgres database for isolated testing instead of coordinating 7 different services.

**Cost:** Eliminate managed Elasticsearch (~$200/mo), Pinecone (~$70/mo), InfluxDB (~$50/mo), Redis (~$30/mo) clusters. One RDS/Supabase/Neon instance handles all of it.

**Operational:** `pg_buffercache` for cache diagnostics, `timescaledb_information.chunks` for compression monitoring, `cron.job_run_details` for scheduled job auditing — all in SQL.

---

## 📄 License

MIT License — feel free to use this architecture in your own projects.

---

**Built with ❤️ using PostgreSQL.**
*"It's 2026, Just Use Postgres."*