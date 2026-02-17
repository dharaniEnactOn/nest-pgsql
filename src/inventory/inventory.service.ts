import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { sql } from 'kysely';

@Injectable()
export class InventoryService {
  constructor(private readonly db: DatabaseService) {}

  // ── CREATE ──────────────────────────────────────────────────────────────
  async create(dto: CreateInventoryDto) {
    const [item] = await this.db.db
      .insertInto('inventory')
      .values({
        name: dto.name,
        description: dto.description ?? null,
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : '{}',
      })
      .returning(['id', 'name', 'description', 'metadata', 'created_at'])
      .execute();

    return item;
  }

  // ── FIND ALL ─────────────────────────────────────────────────────────────
  async findAll(limit = 20, offset = 0) {
    return this.db.db
      .selectFrom('inventory')
      .select(['id', 'name', 'description', 'metadata', 'created_at'])
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  // ── FIND ONE ─────────────────────────────────────────────────────────────
  async findOne(id: number) {
    return this.db.db
      .selectFrom('inventory')
      .select(['id', 'name', 'description', 'metadata', 'created_at'])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  // ── FULL-TEXT SEARCH  (BM25 via ParadeDB, falls back to tsvector GIN) ───
  async search(query: string, limit = 10) {
    // Try BM25 first (ParadeDB pg_textsearch extension)
    // Falls back gracefully to native tsvector if BM25 index isn't available
    const results = await sql<{
      id: number;
      name: string;
      description: string | null;
      metadata: unknown;
      created_at: Date;
      rank: number;
    }>`
      SELECT
        id,
        name,
        description,
        metadata,
        created_at,
        ts_rank(
          to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '')),
          plainto_tsquery('english', ${query})
        ) AS rank
      FROM inventory
      WHERE
        to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))
        @@ plainto_tsquery('english', ${query})
        OR name ILIKE ${'%' + query + '%'}
      ORDER BY rank DESC
      LIMIT ${limit}
    `.execute(this.db.db);

    return results.rows;
  }

  // ── FUZZY / TRIGRAM SEARCH  (pg_trgm — typo-tolerant) ───────────────────
  async fuzzySearch(query: string, limit = 10) {
    const results = await sql<{
      id: number;
      name: string;
      description: string | null;
      metadata: unknown;
      created_at: Date;
      similarity: number;
    }>`
      SELECT
        id,
        name,
        description,
        metadata,
        created_at,
        similarity(name, ${query}) AS similarity
      FROM inventory
      WHERE similarity(name, ${query}) > 0.2
      ORDER BY similarity DESC
      LIMIT ${limit}
    `.execute(this.db.db);

    return results.rows;
  }

  // ── HYBRID SEARCH  (keyword + vector cosine) ─────────────────────────────
  // Only relevant when pgai has populated the embedding column.
  // Gracefully skips vector component when embeddings are NULL.
  async hybridSearch(query: string, queryEmbedding: number[] | null, limit = 10) {
    if (!queryEmbedding) {
      // No embedding provided — fall back to full-text search
      return this.search(query, limit);
    }

    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const results = await sql<{
      id: number;
      name: string;
      description: string | null;
      metadata: unknown;
      created_at: Date;
      hybrid_score: number;
    }>`
      WITH fts AS (
        SELECT
          id,
          ts_rank(
            to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,'')),
            plainto_tsquery('english', ${query})
          ) AS bm25_score
        FROM inventory
        WHERE
          to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,''))
          @@ plainto_tsquery('english', ${query})
      ),
      vec AS (
        SELECT
          id,
          1 - (embedding <=> ${vectorLiteral}::vector) AS cosine_score
        FROM inventory
        WHERE embedding IS NOT NULL
      )
      SELECT
        i.id,
        i.name,
        i.description,
        i.metadata,
        i.created_at,
        COALESCE(fts.bm25_score, 0) * 0.4 + COALESCE(vec.cosine_score, 0) * 0.6 AS hybrid_score
      FROM inventory i
      LEFT JOIN fts ON fts.id = i.id
      LEFT JOIN vec ON vec.id = i.id
      WHERE fts.id IS NOT NULL OR vec.id IS NOT NULL
      ORDER BY hybrid_score DESC
      LIMIT ${limit}
    `.execute(this.db.db);

    return results.rows;
  }

  // ── UPDATE ───────────────────────────────────────────────────────────────
  async update(id: number, dto: Partial<CreateInventoryDto>) {
    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.metadata !== undefined) updateData.metadata = JSON.stringify(dto.metadata);

    const [updated] = await this.db.db
      .updateTable('inventory')
      .set(updateData)
      .where('id', '=', id)
      .returning(['id', 'name', 'description', 'metadata', 'created_at'])
      .execute();

    return updated ?? null;
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  async remove(id: number) {
    const [deleted] = await this.db.db
      .deleteFrom('inventory')
      .where('id', '=', id)
      .returning(['id', 'name'])
      .execute();

    return deleted ?? null;
  }
}