# OmniLogistics 🚚

**The All-Postgres Backend.** A production-grade NestJS API that replaces Elasticsearch, Pinecone, Kafka, Redis, InfluxDB, and MongoDB with a single PostgreSQL database using advanced extensions.

This project is a reference implementation of the philosophy: **"It's 2026, Just Use Postgres."**

## 📖 The Philosophy

Modern application architecture often suffers from **database sprawl**. We typically reach for a specialized tool for every problem:
- Need search? → Elasticsearch
- Need vectors? → Pinecone
- Need time-series? → InfluxDB
- Need queues? → Kafka

This leads to operational nightmares, especially in the AI era where agents need to spin up consistent test environments across all these systems.

**OmniLogistics proves you don't need 7 databases.** By leveraging PostgreSQL extensions, we consolidate search, vectors, time-series, queues, caching, and geospatial data into **one roof**.

## 🛠 Tech Stack

| Component | Technology |
| :--- | :--- |
| **Runtime** | Node.js |
| **Framework** | NestJS |
| **Language** | TypeScript |
| **Database** | PostgreSQL (16+) |
| **ORM/Query Builder** | Kysely (Type-safe SQL) |
| **API Docs** | Swagger (OpenAPI 3.0) |
| **Infrastructure** | Docker & Docker Compose |

## 🧩 Features & Extensions

Every feature in this project is powered by a Postgres extension, replacing a specialized external service.

| Feature | Postgres Extension | Replaces |
| :--- | :--- | :--- |
| **Full-Text Search** | `pg_textsearch` (BM25) | Elasticsearch, Solr |
| **Vector Search** | `pgvector` + `pgvectorscale` | Pinecone, Qdrant |
| **AI Embeddings** | `pgai` | External Embedding Pipelines |
| **Time-Series Data** | `TimescaleDB` | InfluxDB, Prometheus |
| **Geospatial** | `PostGIS` | MongoDB Geo, specialized GIS |
| **Message Queues** | `pgmq` | Kafka, RabbitMQ, SQS |
| **Fuzzy Search** | `pg_trgm` | Algolia Typo Tolerance |
| **Caching** | `UNLOGGED Tables` | Redis |
| **Scheduled Jobs** | `pg_cron` | Cron, Airflow |
| **Flexible Schema** | `JSONB` | MongoDB |

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- Docker & Docker Compose
- psql (optional, for debugging)

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/omni-logistics.git
cd omni-logistics
```

### 2. Configure Environment

Create a `.env` file based on the example:

```bash
cp .env.example .env
```

**`.env`**
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/omnilogistics
PORT=3000
```

### 3. Start the Database

We use a TimescaleDB Docker image which includes most required extensions (PostGIS, pgvector, Timescale). 

> **Note:** For extensions like `pg_textsearch` and `pgai`, ensure your Postgres distribution supports them (e.g., Tiger Data, ParadeDB, or custom builds). The provided migration script handles enabling them.

```bash
# 1. Tear down current container + volume
docker compose down -v

# 2. Build the custom image (this will take 5-10 mins — Rust compile)
docker compose build

# 3. Start it up
docker compose up -d

# 4. Once healthy, verify pgmq is there
docker compose exec db psql -U postgres -d omnilogistics -c "SELECT extname, extversion FROM pg_extension ORDER BY extname;"
```

### 4. Run Migrations

Apply the schema, enable extensions, and create hypertables/queues.

```bash
# Connect to the DB
docker-compose exec db psql -U postgres -d omnilogistics -f /docker-entrypoint-initdb.d/001_init_extensions.sql

# Or if you mounted migrations locally:
psql $DATABASE_URL -f migrations/001_init_extensions.sql
```

### 5. Install Dependencies & Run

```bash
npm install
npm run start:dev
```

### 6. Explore the API

Once running, the API will be available at `http://localhost:3000`.

- **Swagger Documentation:** [http://localhost:3000/api](http://localhost:3000/api)
- **Health Check:** `http://localhost:3000/health`

## 📂 Project Structure

```text
src/
├── database/          # Kysely setup & Postgres type definitions
├── inventory/         # Search (BM25), Vectors, AI Embeddings
├── telemetry/         # Time-series data (TimescaleDB)
├── drivers/           # Geospatial queries (PostGIS)
├── orders/            # Async processing (PGMQ)
└── app.module.ts      # Main NestJS module
```

## 🔌 Key Implementation Details

### 1. Hybrid Search (Inventory)
We combine BM25 keyword search and Vector semantic search in a single SQL query. No need to merge results from Elasticsearch and Pinecone.

```typescript
// src/inventory/inventory.service.ts
SELECT 
  -(description <@> 'query') as bm25_score,
  (embedding <=> '[vector]') as vector_dist
FROM inventory
ORDER BY hybrid_score DESC;
```

### 2. Auto-Embeddings (AI)
Using `pgai`, embeddings are generated automatically via database triggers when new items are inserted. No external pipeline code required.

```sql
SELECT ai.create_vectorizer('inventory'::regclass, ...);
```

### 3. Time-Series Ingestion (Telemetry)
Vehicle telemetry is stored in a TimescaleDB hypertable with automatic compression and retention policies.

```typescript
// src/telemetry/telemetry.service.ts
SELECT time_bucket('1 hour', time), AVG(speed) 
FROM vehicle_telemetry 
GROUP BY hour;
```

### 4. Job Queues (Orders)
# API
npm run start:dev

# RabbitMQ (if not already up)
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management

http://localhost:15672/#/
docker start rabbitmq
docker stop rabbitmq

Then restart your API and create an order — you should see `"status": "pending"` in the response and this in the logs:

[OrdersService] Order #X saved to DB only (RabbitMQ unavailable)

## 🧪 Testing the Extensions

You can test the capabilities directly via Swagger:

1.  **Create Inventory Item:** `POST /inventory`  
    *Triggers `pgai` to generate embeddings automatically.*
2.  **Search Items:** `GET /inventory/search?q=headphones`  
    *Uses `pg_textsearch` (BM25) + `pgvector`.*
3.  **Ingest Telemetry:** `POST /telemetry`  
    *Writes to TimescaleDB hypertable.*
4.  **Find Nearby Drivers:** `GET /drivers/nearby?lat=...&lon=...`  
    *Uses `PostGIS` `ST_DWithin`.*
5.  **Place Order:** `POST /orders`  
    *Pushes message to `pgmq`.*

## 🤝 Why This Matters

-   **Simplicity:** One connection string. One backup strategy. One security model.
-   **Consistency:** No data drift between search index and primary DB.
-   **AI-Ready:** Agents can fork a single database for testing instead of coordinating 7 different services.
-   **Cost:** Reduce infrastructure bills by eliminating managed services for search, vectors, and queues.

## 📄 License

MIT License - feel free to use this architecture in your own projects.

---

**Built with ❤️ using PostgreSQL.**  
*Inspired by "It's 2026, Just Use Postgres".*