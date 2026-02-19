-- ============================================================
-- OMNILOGISTICS — 001_init_extensions.sql
-- "It's 2026, Just Use Postgres."
--
-- Extensions loaded:
--   pgvector + pgvectorscale  → Vector / semantic search
--   timescaledb               → Time-series hypertables
--   postgis                   → Geospatial queries
--   pgmq                      → Message queues
--   pg_trgm                   → Fuzzy / trigram search
--   pg_cron                   → Scheduled jobs
--   ai (pgai)                 → Auto-embeddings via DB trigger
--   pg_buffercache            → Cache observability (bonus)
--
-- Each CREATE EXTENSION is wrapped in a DO block so the
-- migration never hard-fails on a provider that doesn't
-- support a given extension — it logs a NOTICE instead.
-- ============================================================


-- ============================================================
-- 1. VECTOR SEARCH  →  replaces Pinecone / Qdrant
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector (cosine, L2, inner-product)

DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS vectorscale; -- pgvectorscale (StreamingDiskANN)
    RAISE NOTICE 'pgvectorscale loaded ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvectorscale not available — using pgvector HNSW only';
END $$;


-- ============================================================
-- 2. TIME-SERIES  →  replaces InfluxDB / Prometheus
-- ============================================================

DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
    RAISE NOTICE 'TimescaleDB loaded ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB not available — using plain tables';
END $$;


-- ============================================================
-- 3. GEOSPATIAL  →  replaces MongoDB Geo / dedicated GIS
-- ============================================================

DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
    RAISE NOTICE 'PostGIS loaded ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS not available';
END $$;


-- ============================================================
-- 4. MESSAGE QUEUE  →  replaces Kafka / RabbitMQ / SQS
-- ============================================================

DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS pgmq;
    RAISE NOTICE 'pgmq loaded ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgmq not available — creating manual queue table';

    CREATE TABLE IF NOT EXISTS orders_queue (
        msg_id             BIGSERIAL    PRIMARY KEY,
        message            JSONB        NOT NULL,
        created_at         TIMESTAMPTZ  DEFAULT NOW(),
        visibility_timeout TIMESTAMPTZ,
        processed          BOOLEAN      DEFAULT FALSE
    );
END $$;


-- ============================================================
-- 5. BM25 / FULL-TEXT SEARCH  →  replaces Elasticsearch / Solr
-- ============================================================

DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_textsearch; -- ParadeDB BM25
    RAISE NOTICE 'pg_textsearch (BM25) loaded ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_textsearch not available — using tsvector GIN fallback';
END $$;

-- Trigram fuzzy search (almost always available)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    RAISE NOTICE 'pg_trgm loaded ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm not available';
END $$;


-- ============================================================
-- 6. AI EMBEDDINGS  →  replaces external embedding pipelines
-- ============================================================

DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS ai;
    RAISE NOTICE 'pgai loaded ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgai not available — embeddings generated in application layer';
END $$;


-- ============================================================
-- 7. SCHEDULED JOBS  →  replaces cron / Airflow
-- ============================================================

DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    RAISE NOTICE 'pg_cron loaded ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available';
END $$;


-- ============================================================
-- 8. CACHE OBSERVABILITY  (bonus, usually built-in)
-- ============================================================

DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_buffercache;
    RAISE NOTICE 'pg_buffercache loaded ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_buffercache not available';
END $$;


-- ============================================================
-- TABLES
-- ============================================================

-- ----------------------------------------------------------
-- INVENTORY  (search + vectors + flexible schema)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory (
    id          SERIAL       PRIMARY KEY,
    name        TEXT         NOT NULL,
    description TEXT,
    metadata    JSONB        DEFAULT '{}',   -- replaces MongoDB docs
    embedding   vector(1536),               -- OpenAI / pgai embeddings
    created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- BM25 index (ParadeDB) — falls back to GIN tsvector
DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS idx_inventory_bm25
        ON inventory USING bm25 (name, description)
        WITH (text_config = 'english');
EXCEPTION WHEN OTHERS THEN
    CREATE INDEX IF NOT EXISTS idx_inventory_fts
        ON inventory USING GIN (
            to_tsvector('english',
                coalesce(name, '') || ' ' || coalesce(description, ''))
        );
END $$;

-- HNSW vector index for semantic similarity
CREATE INDEX IF NOT EXISTS idx_inventory_vector
    ON inventory USING hnsw (embedding vector_cosine_ops);

-- Trigram index for typo-tolerant search
DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS idx_inventory_trgm
        ON inventory USING GIN (name gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Trigram index not created';
END $$;


-- ----------------------------------------------------------
-- VEHICLE TELEMETRY  (TimescaleDB hypertable)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_telemetry (
    time          TIMESTAMPTZ   NOT NULL,
    vehicle_id    TEXT          NOT NULL,
    speed         DOUBLE PRECISION,
    battery_level DOUBLE PRECISION,
    temperature   DOUBLE PRECISION,
    location      GEOGRAPHY(POINT, 4326)   -- live GPS via PostGIS
);

DO $$ BEGIN
    PERFORM create_hypertable(
        'vehicle_telemetry', 'time',
        if_not_exists => TRUE
    );
    -- Compress chunks older than 7 days
    ALTER TABLE vehicle_telemetry SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'vehicle_id'
    );
    SELECT add_compression_policy('vehicle_telemetry', INTERVAL '7 days');
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB hypertable not created — using plain table';
END $$;

CREATE INDEX IF NOT EXISTS idx_telemetry_time    ON vehicle_telemetry (time DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle ON vehicle_telemetry (vehicle_id, time DESC);


-- ----------------------------------------------------------
-- DRIVERS  (PostGIS geospatial)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS drivers (
    id       SERIAL       PRIMARY KEY,
    name     TEXT         NOT NULL,
    location GEOGRAPHY(POINT, 4326),
    status   TEXT         DEFAULT 'offline'   -- online | offline | busy
);

DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS idx_drivers_location ON drivers USING GIST (location);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS GIST index not created';
END $$;


-- ----------------------------------------------------------
-- ROUTE CACHE  (UNLOGGED table → replaces Redis)
-- ----------------------------------------------------------
CREATE UNLOGGED TABLE IF NOT EXISTS route_cache (
    route_id   TEXT        PRIMARY KEY,
    data       JSONB,
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cache_expires ON route_cache (expires_at);


-- ----------------------------------------------------------
-- ORDERS QUEUE via pgmq  (if extension loaded)
-- ----------------------------------------------------------
DO $$ BEGIN
    PERFORM pgmq.create('orders_queue');
    RAISE NOTICE 'pgmq queue "orders_queue" created ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgmq queue skipped — using fallback table';
END $$;


-- ============================================================
-- SCHEDULED JOBS (pg_cron)
-- ============================================================

-- Purge expired route cache entries every hour
DO $$ BEGIN
    PERFORM cron.schedule(
        'purge-route-cache',
        '0 * * * *',
        $sql$DELETE FROM route_cache WHERE expires_at < NOW()$sql$
    );
    RAISE NOTICE 'pg_cron job "purge-route-cache" scheduled ✓';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available — skipping scheduled jobs';
END $$;


-- ============================================================
-- SAMPLE SEED DATA
-- ============================================================

INSERT INTO inventory (name, description, metadata) VALUES
    ('Wireless Headphones',  'Noise-cancelling Bluetooth headphones',   '{"price": 199.99, "category": "electronics"}'),
    ('USB-C Cable 6ft',      'Fast-charging braided cable',             '{"price":  19.99, "category": "accessories"}'),
    ('Adjustable Desk Stand','Aluminium laptop stand, height-adjustable','{"price":  49.99, "category": "accessories"}')
ON CONFLICT DO NOTHING;

DO $$ BEGIN
    INSERT INTO drivers (name, location, status) VALUES
        ('Alice Chen',  ST_MakePoint(-122.4194, 37.7749)::geography, 'online'),
        ('Bob Okafor',  ST_MakePoint(-122.4094, 37.7849)::geography, 'online'),
        ('Priya Nair',  ST_MakePoint(-122.4294, 37.7649)::geography, 'busy')
    ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS seed skipped';
END $$;


-- ============================================================
-- SUMMARY
-- ============================================================
DO $$
DECLARE
    ext TEXT;
    loaded TEXT[] := '{}';
BEGIN
    FOREACH ext IN ARRAY ARRAY['vector','vectorscale','timescaledb','postgis',
                               'pgmq','pg_textsearch','pg_trgm','ai','pg_cron',
                               'pg_buffercache']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = ext) THEN
            loaded := array_append(loaded, ext);
        END IF;
    END LOOP;
    RAISE NOTICE '=== Extensions active: % ===', array_to_string(loaded, ', ');
END $$;