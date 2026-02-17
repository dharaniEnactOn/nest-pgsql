-- ============================================
-- OMNILOGISTICS MIGRATION (Compatible Version)
-- ============================================

-- 1. VECTOR SEARCH (pgvector) - Core AI Feature
CREATE EXTENSION IF NOT EXISTS "vector";

-- Try pgvectorscale (may not be available on all providers)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "vectorscale";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'vectorscale not available, using pgvector only';
END $$;

-- 2. TIME-SERIES (TimescaleDB)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'timescaledb not available, using native tables';
END $$;

-- 3. GEOSPATIAL (PostGIS)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "postgis";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'postgis not available';
END $$;

-- 4. PGMQ (Message Queue) - WITH FALLBACK
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "pgmq";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgmq not available, creating fallback queue table';
    
    -- Fallback: Simple queue table without pgmq extension
    CREATE TABLE IF NOT EXISTS orders_queue (
        msg_id BIGSERIAL PRIMARY KEY,
        message JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        visibility_timeout TIMESTAMPTZ,
        processed BOOLEAN DEFAULT FALSE
    );
END $$;

-- 5. TEXT SEARCH (pg_textsearch / BM25)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_textsearch";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_textsearch not available, using native tsvector';
END $$;

-- 6. FUZZY SEARCH (pg_trgm) - Usually Available
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm not available';
END $$;

-- 7. AI EMBEDDINGS (pgai)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "ai";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgai not available, embeddings must be generated externally';
END $$;

-- 8. CRON JOBS (pg_cron)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "pg_cron";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available';
END $$;

-- ============================================
-- CREATE TABLES
-- ============================================

-- 1. INVENTORY (Search, Vectors, JSONB)
CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- BM25 Index (if pg_textsearch available)
DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS idx_inventory_bm25 ON inventory 
    USING bm25 (name, description) WITH (text_config = 'english');
EXCEPTION WHEN OTHERS THEN
    -- Fallback: Native Postgres full-text search
    CREATE INDEX IF NOT EXISTS idx_inventory_fts ON inventory 
    USING GIN (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '')));
END $$;

-- Vector Index
CREATE INDEX IF NOT EXISTS idx_inventory_vector ON inventory 
USING hnsw (embedding vector_cosine_ops);

-- Fuzzy Search Index (if pg_trgm available)
DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS idx_inventory_trgm ON inventory 
    USING GIN (name gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not create trgm index';
END $$;

-- 2. TELEMETRY (TimescaleDB Hypertable)
CREATE TABLE IF NOT EXISTS vehicle_telemetry (
    time TIMESTAMPTZ NOT NULL,
    vehicle_id TEXT NOT NULL,
    speed DOUBLE PRECISION,
    battery_level DOUBLE PRECISION,
    temperature DOUBLE PRECISION
);

-- Convert to hypertable if TimescaleDB is available
DO $$ BEGIN
    PERFORM create_hypertable('vehicle_telemetry', 'time', if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB not available, using native table';
END $$;

-- Create standard index as fallback
CREATE INDEX IF NOT EXISTS idx_telemetry_time ON vehicle_telemetry (time DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle ON vehicle_telemetry (vehicle_id);

-- 3. DRIVERS (PostGIS)
CREATE TABLE IF NOT EXISTS drivers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    location GEOGRAPHY(POINT, 4326),
    status TEXT DEFAULT 'offline'
);

DO $$ BEGIN
    CREATE INDEX IF NOT EXISTS idx_drivers_location ON drivers USING GIST (location);
EXCEPTION WHEN OTHERS THEN
    -- Fallback: Store lat/lon as separate columns
    RAISE NOTICE 'PostGIS not available, consider adding lat/lon columns';
END $$;

-- 4. CACHE (UNLOGGED Table)
CREATE UNLOGGED TABLE IF NOT EXISTS route_cache (
    route_id TEXT PRIMARY KEY,
    data JSONB,
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cache_expires ON route_cache (expires_at);

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

INSERT INTO inventory (name, description, metadata) VALUES
    ('Wireless Headphones', 'High-quality noise cancelling headphones with Bluetooth', '{"price": 199.99, "category": "electronics"}'),
    ('USB-C Cable', 'Fast charging cable 6ft length', '{"price": 19.99, "category": "accessories"}'),
    ('Laptop Stand', 'Adjustable aluminum laptop stand', '{"price": 49.99, "category": "accessories"}')
ON CONFLICT DO NOTHING;

INSERT INTO drivers (name, location, status) VALUES
    ('John Doe', ST_MakePoint(-122.4194, 37.7749)::geography, 'online'),
    ('Jane Smith', ST_MakePoint(-122.4094, 37.7849)::geography, 'online')
ON CONFLICT DO NOTHING;