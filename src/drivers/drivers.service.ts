import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import {
  DriverRow,
  NearbyDriverRow,
  DriverNameMatch,
  DriverDistance,
} from './driver.types';

// ──────────────────────────────────────────────────────────────────────────────
// DriversService
//
// Extensions used:
//   • postgis (3.6.2) — drivers.location is GEOGRAPHY(POINT, 4326)
//       ST_MakePoint / ST_SetSRID  → build geography from lon/lat on write
//       ST_AsGeoJSON               → serialize location back to GeoJSON on read
//       ST_DWithin                 → radius-based proximity search (metres)
//       ST_Distance                → exact distance computation between two points
//   • pg_trgm (1.6)    — fuzzy name search for driver lookup
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class DriversService {
  constructor(private readonly db: DatabaseService) { }

  // ── CREATE ───────────────────────────────────────────────────────────────────
  /**
   * Insert a new driver. If `location` is provided it is stored as a
   * PostGIS GEOGRAPHY(POINT, 4326) via ST_MakePoint.
   */
  async create(dto: CreateDriverDto): Promise<DriverRow> {
    const locationExpr = dto.location
      ? sql`ST_SetSRID(ST_MakePoint(${dto.location.lon}, ${dto.location.lat}), 4326)::geography`
      : sql`NULL`;

    const result = await sql<DriverRow>`
      INSERT INTO drivers (name, location, status)
      VALUES (
        ${dto.name},
        ${locationExpr},
        ${dto.status ?? 'offline'}
      )
      RETURNING
        id,
        name,
        status,
        ST_AsGeoJSON(location)::jsonb AS location
    `.execute(this.db.db);

    return result.rows[0];
  }

  // ── LIST ALL ─────────────────────────────────────────────────────────────────
  /**
   * Return all drivers with their GeoJSON location, optionally filtered by
   * status.
   */
  async findAll(status?: string, limit = 50, offset = 0): Promise<DriverRow[]> {
    const statusFilter = status
      ? sql`WHERE status = ${status}`
      : sql``;

    const result = await sql<DriverRow>`
      SELECT
        id,
        name,
        status,
        ST_AsGeoJSON(location)::jsonb AS location
      FROM drivers
      ${statusFilter}
      ORDER BY id DESC
      LIMIT ${limit} OFFSET ${offset}
    `.execute(this.db.db);

    return result.rows;
  }

  // ── FIND ONE ─────────────────────────────────────────────────────────────────
  async findOne(id: number): Promise<DriverRow> {
    const result = await sql<DriverRow>`
      SELECT
        id,
        name,
        status,
        ST_AsGeoJSON(location)::jsonb AS location
      FROM drivers
      WHERE id = ${id}
    `.execute(this.db.db);

    if (!result.rows[0]) {
      throw new NotFoundException(`Driver #${id} not found`);
    }
    return result.rows[0];
  }

  // ── UPDATE ───────────────────────────────────────────────────────────────────
  /**
   * Update driver fields. The location column is rebuilt via ST_MakePoint
   * if a new position is supplied; otherwise it is left unchanged.
   */
  async update(id: number, dto: UpdateDriverDto): Promise<DriverRow> {
    // Verify existence first
    await this.findOne(id);

    const setParts: ReturnType<typeof sql>[] = [];

    if (dto.name !== undefined) {
      setParts.push(sql`name = ${dto.name}`);
    }
    if (dto.status !== undefined) {
      setParts.push(sql`status = ${dto.status}`);
    }
    if (dto.location !== undefined) {
      setParts.push(
        sql`location = ST_SetSRID(ST_MakePoint(${dto.location.lon}, ${dto.location.lat}), 4326)::geography`,
      );
    }

    if (setParts.length === 0) {
      return this.findOne(id);
    }

    // Build comma-separated SET list
    const setClause = setParts.reduce(
      (acc, part, i) => (i === 0 ? part : sql`${acc}, ${part}`),
    );

    const result = await sql<DriverRow>`
      UPDATE drivers
      SET ${setClause}
      WHERE id = ${id}
      RETURNING
        id,
        name,
        status,
        ST_AsGeoJSON(location)::jsonb AS location
    `.execute(this.db.db);

    return result.rows[0];
  }

  // ── REMOVE ───────────────────────────────────────────────────────────────────
  async remove(id: number): Promise<{ message: string; id: number }> {
    await this.findOne(id); // throws 404 if missing

    await sql`DELETE FROM drivers WHERE id = ${id}`.execute(this.db.db);

    return { message: `Driver #${id} deleted`, id };
  }

  // ── NEARBY (PostGIS ST_DWithin) ──────────────────────────────────────────────
  /**
   * Find drivers within `radiusMetres` of the given coordinate.
   * Uses the PostGIS `ST_DWithin` function which leverages the GIST index on
   * `drivers.location` — no sequential scan needed.
   *
   * Results are ordered by ascending distance so the closest driver is first.
   *
   * @param lat        - Latitude of the reference point
   * @param lon        - Longitude of the reference point
   * @param radiusMetres - Search radius in metres (default 5 km)
   * @param status     - Optional status filter (e.g. 'online')
   */
  async findNearby(
    lat: number,
    lon: number,
    radiusMetres = 5000,
    status?: string,
  ): Promise<NearbyDriverRow[]> {
    const statusFilter = status
      ? sql`AND status = ${status}`
      : sql``;

    const result = await sql<NearbyDriverRow>`
      SELECT
        id,
        name,
        status,
        ST_AsGeoJSON(location)::jsonb        AS location,
        ST_Distance(
          location,
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
        )::int                               AS distance_m
      FROM drivers
      WHERE
        location IS NOT NULL
        AND ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
          ${radiusMetres}
        )
        ${statusFilter}
      ORDER BY distance_m ASC
    `.execute(this.db.db);

    return result.rows;
  }

  // ── UPDATE LOCATION ──────────────────────────────────────────────────────────
  /**
   * Lightweight GPS ping endpoint — updates only the location column.
   * Called frequently by driver apps; avoids loading the full record.
   */
  async updateLocation(
    id: number,
    lat: number,
    lon: number,
  ): Promise<DriverRow> {
    const result = await sql<DriverRow>`
      UPDATE drivers
      SET location = ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
      WHERE id = ${id}
      RETURNING
        id,
        name,
        status,
        ST_AsGeoJSON(location)::jsonb AS location
    `.execute(this.db.db);

    if (!result.rows[0]) {
      throw new NotFoundException(`Driver #${id} not found`);
    }
    return result.rows[0];
  }

  // ── ROUTE DISTANCE (ST_Distance) ─────────────────────────────────────────────
  /**
   * Compute the straight-line distance in metres between two drivers using
   * PostGIS `ST_Distance` on GEOGRAPHY columns (accounts for Earth's curvature).
   */
  async distanceBetween(
    driverAId: number,
    driverBId: number,
  ): Promise<DriverDistance> {
    const result = await sql<{ distance_m: number }>`
      SELECT ST_Distance(a.location, b.location)::int AS distance_m
      FROM drivers a, drivers b
      WHERE a.id = ${driverAId}
        AND b.id = ${driverBId}
        AND a.location IS NOT NULL
        AND b.location IS NOT NULL
    `.execute(this.db.db);

    if (!result.rows[0]) {
      throw new NotFoundException(
        `Could not compute distance — one or both drivers (#${driverAId}, #${driverBId}) have no location or do not exist`,
      );
    }

    return {
      driver_a: driverAId,
      driver_b: driverBId,
      distance_m: result.rows[0].distance_m,
    };
  }

  // ── NAME FUZZY SEARCH (pg_trgm) ──────────────────────────────────────────────
  /**
   * Typo-tolerant name search powered by `pg_trgm` similarity().
   * Useful when a dispatcher is looking up a driver by approximate name.
   */
  async searchByName(
    query: string,
    limit = 10,
  ): Promise<DriverNameMatch[]> {
    const result = await sql<DriverNameMatch>`
      SELECT
        id,
        name,
        status,
        ST_AsGeoJSON(location)::jsonb AS location,
        similarity(name, ${query})    AS similarity
      FROM drivers
      WHERE similarity(name, ${query}) > 0.15
      ORDER BY similarity DESC
      LIMIT ${limit}
    `.execute(this.db.db);

    return result.rows;
  }
}