-- ============================================================
-- OMNILOGISTICS — 002_orders_table.sql
--
-- Adds the persistent `orders` table.
--
-- Context: pgmq is NOT available in this deployment.
-- Async order processing uses RabbitMQ instead.
-- This table is the durable source of truth — RabbitMQ is
-- the delivery mechanism only. Orders survive broker restarts.
-- ============================================================

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

-- Index for status-based polling (worker queries)
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders (status, created_at DESC);
-- Index for per-customer order history
CREATE INDEX IF NOT EXISTS idx_orders_customer   ON orders (customer_id, created_at DESC);
-- Index for per-driver workload
CREATE INDEX IF NOT EXISTS idx_orders_driver     ON orders (driver_id, status);

-- Auto-update updated_at on every row change (plpgsql — always available)
CREATE OR REPLACE FUNCTION orders_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION orders_set_updated_at();

-- ============================================================
-- Remove the legacy pgmq DO block comment in 001 if present.
-- The DO block was already a no-op (pgmq not available) and
-- created the `orders_queue` fallback table. Drop it cleanly
-- so we don't have two competing queue tables.
-- ============================================================
DROP TABLE IF EXISTS orders_queue;