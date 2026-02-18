# Inventory Module

> **Location:** `src/inventory/`  
> **Extensions used:** `pgvector` · `vectorscale` · `pg_trgm` · `plpgsql` (full-text via `tsvector`)  
> **Replaces:** Elasticsearch (search) · Pinecone (vectors) · MongoDB (flexible schema)

---

## Overview

The Inventory module is the search backbone of OmniLogistics. It stores product records in a standard PostgreSQL table enriched with three parallel search indexes — full-text, trigram, and vector — so a single query can rank results by keyword relevance, typo tolerance, and semantic meaning simultaneously. No external search service is required.

---

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS inventory (
    id          SERIAL        PRIMARY KEY,
    name        TEXT          NOT NULL,
    description TEXT,
    metadata    JSONB         DEFAULT '{}',   -- flexible schema (replaces MongoDB)
    embedding   vector(1536),                 -- pgvector: OpenAI / pgai embeddings
    created_at  TIMESTAMPTZ   DEFAULT NOW()
);
```

### Indexes

| Index | Type | Extension | Purpose |
|---|---|---|---|
| `idx_inventory_bm25` | `bm25` (ParadeDB) | `pg_textsearch` | BM25 full-text ranking (primary) |
| `idx_inventory_fts` | `GIN tsvector` | built-in | Full-text fallback when BM25 unavailable |
| `idx_inventory_vector` | `HNSW` | `pgvector` / `vectorscale` | Cosine-similarity vector search |
| `idx_inventory_trgm` | `GIN gin_trgm_ops` | `pg_trgm` | Trigram fuzzy / typo-tolerant search |

The migration wraps the BM25 and trigram `CREATE INDEX` calls in `DO $$ BEGIN … EXCEPTION WHEN OTHERS THEN … END $$` blocks so the migration never hard-fails on a Postgres distribution that doesn't have those extensions installed.

---

## File Structure

```
src/inventory/
├── inventory.module.ts          # NestJS module wiring
├── inventory.controller.ts      # REST endpoints + Swagger decorators
├── inventory.service.ts         # All DB logic (Kysely + raw SQL)
└── dto/
    ├── create-inventory.dto.ts  # Input shape for POST / PUT
    └── update-inventory.dto.ts  # PartialType of CreateInventoryDto
```

---

## API Endpoints

### `POST /inventory`
Create a new inventory item.

**Request body:**
```json
{
  "name": "Wireless Headphones",
  "description": "Noise-cancelling over-ear headphones with 30hr battery",
  "metadata": { "sku": "WH-1000", "category": "electronics", "price": 299.99 }
}
```

**Response:** The inserted row including auto-generated `id` and `created_at`.

---

### `GET /inventory`
List all items, ordered by `created_at DESC`. Paginated.

| Query param | Default | Description |
|---|---|---|
| `limit` | `20` | Rows per page |
| `offset` | `0` | Pagination offset |

---

### `GET /inventory/search?q=`
**Full-text search** using `tsvector` + `ts_rank`. Falls back gracefully from BM25 (ParadeDB) to native GIN `tsvector` if the ParadeDB extension is not available. Also performs an `ILIKE` scan as a safety net so partial matches are never missed.

```sql
SELECT id, name, description, metadata, created_at,
  ts_rank(
    to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,'')),
    plainto_tsquery('english', $query)
  ) AS rank
FROM inventory
WHERE
  to_tsvector('english', ...) @@ plainto_tsquery('english', $query)
  OR name ILIKE '%$query%'
ORDER BY rank DESC
LIMIT $limit
```

| Query param | Default | Description |
|---|---|---|
| `q` | *(required)* | Search term(s) |
| `limit` | `10` | Max results |

---

### `GET /inventory/fuzzy?q=`
**Typo-tolerant search** powered by `pg_trgm`. Computes the trigram `similarity()` between the query and every item name and returns only results above a 0.2 threshold. Useful for catching misspellings like `hedphones → headphones`.

```sql
SELECT id, name, description, metadata, created_at,
  similarity(name, $query) AS similarity
FROM inventory
WHERE similarity(name, $query) > 0.2
ORDER BY similarity DESC
LIMIT $limit
```

| Query param | Default | Description |
|---|---|---|
| `q` | *(required)* | Possibly misspelled search term |
| `limit` | `10` | Max results |

---

### `GET /inventory/:id`
Fetch a single item by its primary key. Returns `404` if not found.

---

### `PUT /inventory/:id`
Update `name`, `description`, and/or `metadata` on an existing item. Only fields present in the body are updated. Returns `404` if the item does not exist.

---

### `DELETE /inventory/:id`
Hard-delete an item. Returns `{ message, id }` on success or `404` if not found.

---

## Service Methods

### `create(dto)`
Standard Kysely `insertInto` returning the full row. `metadata` is serialised to JSON before insert.

### `findAll(limit, offset)`
Kysely `selectFrom` with `orderBy('created_at', 'desc')`.

### `findOne(id)`
`executeTakeFirst()` — returns `undefined` (not an error) when the row is missing; the controller layer converts this to a `404`.

### `search(query, limit)`
Raw SQL via Kysely's `sql` tag. Uses `plainto_tsquery` (safe, no injection risk) over a `tsvector` of `name || ' ' || description`. The `ts_rank` score is returned alongside each row so callers can display relevance.

### `fuzzySearch(query, limit)`
Raw SQL using `pg_trgm`'s `similarity()` function. Threshold is `0.2` — low enough to catch most single-character typos without returning unrelated results.

### `hybridSearch(query, queryEmbedding, limit)`
Combines full-text and vector search in a single CTE query. If no embedding is provided it automatically falls back to `search()`.

**Scoring weights:** 40% BM25 score + 60% cosine similarity.

```sql
WITH fts AS (
  SELECT id, ts_rank(...) AS bm25_score FROM inventory WHERE ...
),
vec AS (
  SELECT id, 1 - (embedding <=> $vector::vector) AS cosine_score
  FROM inventory WHERE embedding IS NOT NULL
)
SELECT ...,
  COALESCE(fts.bm25_score, 0) * 0.4
  + COALESCE(vec.cosine_score, 0) * 0.6 AS hybrid_score
FROM inventory i
LEFT JOIN fts ON fts.id = i.id
LEFT JOIN vec ON vec.id = i.id
WHERE fts.id IS NOT NULL OR vec.id IS NOT NULL
ORDER BY hybrid_score DESC
LIMIT $limit
```

### `update(id, dto)`
Builds a partial update object from only the fields present in the DTO, then runs a Kysely `updateTable` returning the updated row.

### `remove(id)`
Kysely `deleteFrom` with `returning(['id', 'name'])`. Returns `null` when the row doesn't exist (controller handles the `404`).

---

## Extension Deep-Dive

### `pgvector` + `vectorscale` (0.8.1 / 0.9.0)

The `embedding` column stores 1536-dimension float vectors (OpenAI `text-embedding-3-small` size). The `<=>` operator computes cosine distance. The HNSW index (`idx_inventory_vector`) makes ANN queries sub-millisecond even at millions of rows.

`pgvectorscale`'s StreamingDiskANN index can be swapped in for even higher recall on large datasets without loading the full index into RAM.

```sql
-- Cosine similarity (lower distance = more similar)
SELECT id, name, 1 - (embedding <=> '[0.1, 0.2, ...]'::vector) AS score
FROM inventory
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 10;
```

### `pg_trgm` (1.6)

Breaks strings into overlapping 3-character sequences (trigrams) and measures the fraction that two strings share. A `similarity` of `1.0` is an exact match; `0.3` is a close typo.

The GIN index on `name gin_trgm_ops` means the similarity scan never does a full-table seq scan.

```sql
-- "hedphones" still finds "headphones" (similarity ≈ 0.44)
SELECT similarity('hedphones', 'headphones');
-- → 0.4444...
```

### Full-text search (`tsvector` / `plainto_tsquery`)

Built-in PostgreSQL. The GIN index on `to_tsvector('english', name || ' ' || description)` supports ranked keyword search in English with stemming (so "running" matches "run"). `ts_rank` returns a float score used for result ordering.

---

## DTO Reference

### `CreateInventoryDto`

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Item name |
| `description` | `string` | ❌ | Free-text description |
| `metadata` | `Record<string, unknown>` | ❌ | Arbitrary JSONB payload |

### `UpdateInventoryDto`

A `PartialType` of `CreateInventoryDto` — all fields optional. Only provided fields are written to the database.

---

## Example Requests

**Create an item:**
```bash
curl -X POST http://localhost:3000/inventory \
  -H "Content-Type: application/json" \
  -d '{"name":"Mechanical Keyboard","description":"TKL layout, Cherry MX Blue switches","metadata":{"brand":"Keychron","price":129}}'
```

**Full-text search:**
```bash
curl "http://localhost:3000/inventory/search?q=mechanical+keyboard&limit=5"
```

**Fuzzy search (typo):**
```bash
curl "http://localhost:3000/inventory/fuzzy?q=mechanikal+keybord"
```

**Update metadata:**
```bash
curl -X PUT http://localhost:3000/inventory/1 \
  -H "Content-Type: application/json" \
  -d '{"metadata":{"brand":"Keychron","price":109,"on_sale":true}}'
```

**Delete:**
```bash
curl -X DELETE http://localhost:3000/inventory/1
```

---

## Notes & Design Decisions

**Why JSONB for metadata?** It allows arbitrary per-item fields (SKU, weight, category, pricing tiers) without schema migrations. The `@>` containment operator and GIN indexes make JSONB queries fast.

**Why three search indexes?** Each handles a different failure mode. Full-text handles semantic keyword overlap. Trigram handles typos and partial matches. Vectors handle meaning-based similarity where keywords don't overlap at all (e.g. "laptop bag" matching "notebook sleeve").

**Embeddings are nullable.** The vector column is `NULL` until a pgai vectorizer or an external pipeline populates it. The `hybridSearch` method checks for `NULL` embeddings and falls back gracefully, so the API works correctly even before embeddings are generated.

**No soft-delete.** Items are hard-deleted. If audit trails are needed, add a `deleted_at TIMESTAMPTZ` column and adjust all queries to filter `WHERE deleted_at IS NULL`.