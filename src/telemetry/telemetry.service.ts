import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service';
import { CreateTelemetryDto } from './dto/create-telemetry.dto';

// ──────────────────────────────────────────────────────────────────────────────
// TelemetryService
//
// Extensions used:
//   • timescaledb  — vehicle_telemetry is a hypertable; time_bucket() aggregates
//   • postgis      — location column is GEOGRAPHY(POINT,4326); ST_AsGeoJSON()
//   • pg_cron      — retention + compression policies are scheduled by TimescaleDB
// ──────────────────────────────────────────────────────────────────────────────
@Injectable()
export class TelemetryService {
  constructor(private readonly db: DatabaseService) { }

  // ── INGEST ────────────────────────────────────────────────────────────────
  /**
   * Insert a single telemetry reading into the TimescaleDB hypertable.
   * The `location` field is converted to a PostGIS geography point via
   * ST_MakePoint so it is stored natively alongside the other sensor data.
   */
  async create(dto: CreateTelemetryDto) {
    const time = dto.time ? new Date(dto.time) : new Date();

    // Build the PostGIS geography value or null
    const locationExpr =
      dto.location
        ? sql`ST_SetSRID(ST_MakePoint(${dto.location.lon}, ${dto.location.lat}), 4326)::geography`
        : sql`NULL`;

    const result = await sql<{
      time: Date;
      vehicle_id: string;
      speed: number | null;
      battery_level: number | null;
      temperature: number | null;
      location: string | null;
    }>`
      INSERT INTO vehicle_telemetry (time, vehicle_id, speed, battery_level, temperature, location)
      VALUES (
        ${time},
        ${dto.vehicle_id},
        ${dto.speed ?? null},
        ${dto.battery_level ?? null},
        ${dto.temperature ?? null},
        ${locationExpr}
      )
      RETURNING
        time,
        vehicle_id,
        speed,
        battery_level,
        temperature,
        ST_AsGeoJSON(location)::jsonb AS location
    `.execute(this.db.db);

    return result.rows[0];
  }

  // ── LIST (recent, paginated) ───────────────────────────────────────────────
  /**
   * Returns the most recent telemetry rows, optionally filtered by vehicle.
   * TimescaleDB's chunk-exclusion optimizer makes time-DESC queries very fast.
   */
  async findAll(
    vehicle_id?: string,
    limit = 50,
    offset = 0,
  ) {
    let query = this.db.db
      .selectFrom('vehicle_telemetry')
      .select([
        'time',
        'vehicle_id',
        'speed',
        'battery_level',
        'temperature',
        sql<string>`ST_AsGeoJSON(location)::jsonb`.as('location'),
      ])
      .orderBy('time', 'desc')
      .limit(limit)
      .offset(offset);

    if (vehicle_id) {
      query = query.where('vehicle_id', '=', vehicle_id);
    }

    return query.execute();
  }

  // ── LATEST READING PER VEHICLE ────────────────────────────────────────────
  /**
   * Returns the single most-recent row for a given vehicle.
   * Useful for a live fleet-status dashboard.
   */
  async findLatest(vehicle_id: string) {
    const row = await this.db.db
      .selectFrom('vehicle_telemetry')
      .select([
        'time',
        'vehicle_id',
        'speed',
        'battery_level',
        'temperature',
        sql<string>`ST_AsGeoJSON(location)::jsonb`.as('location'),
      ])
      .where('vehicle_id', '=', vehicle_id)
      .orderBy('time', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!row) throw new NotFoundException(`No telemetry found for vehicle ${vehicle_id}`);
    return row;
  }

  // ── TIME-BUCKET AGGREGATION (TimescaleDB) ─────────────────────────────────
  /**
   * Aggregates sensor readings into configurable time buckets using
   * TimescaleDB's time_bucket() function — the core value-add over plain PG.
   *
   * @param vehicle_id  Vehicle to aggregate
   * @param bucket      PostgreSQL interval string, e.g. '1 hour', '15 minutes'
   * @param from        ISO-8601 start of the window (defaults to 24 h ago)
   * @param to          ISO-8601 end of the window   (defaults to now)
   */
  async aggregate(
    vehicle_id: string,
    bucket = '1 hour',
    from?: string,
    to?: string,
  ) {
    const fromTime = from ? new Date(from) : new Date(Date.now() - 86_400_000);
    const toTime = to ? new Date(to) : new Date();

    return sql<{
      bucket: Date;
      vehicle_id: string;
      avg_speed: number;
      avg_battery: number;
      avg_temperature: number;
      readings: number;
    }>`
      SELECT
        time_bucket(${bucket}::interval, time) AS bucket,
        vehicle_id,
        ROUND(AVG(speed)::numeric,         2) AS avg_speed,
        ROUND(AVG(battery_level)::numeric, 2) AS avg_battery,
        ROUND(AVG(temperature)::numeric,   2) AS avg_temperature,
        COUNT(*)::int                         AS readings
      FROM vehicle_telemetry
      WHERE
        vehicle_id = ${vehicle_id}
        AND time BETWEEN ${fromTime} AND ${toTime}
      GROUP BY bucket, vehicle_id
      ORDER BY bucket DESC
    `.execute(this.db.db).then(r => r.rows);
  }

  // ── FLEET SUMMARY ─────────────────────────────────────────────────────────
  /**
   * Returns the last known reading for every distinct vehicle seen in the
   * past `windowHours` hours — handy for a fleet overview screen.
   * Uses DISTINCT ON (a PostgreSQL extension to standard SQL) for efficiency.
   */
  async fleetSummary(windowHours = 24) {
    return sql<{
      vehicle_id: string;
      last_seen: Date;
      speed: number | null;
      battery_level: number | null;
      temperature: number | null;
      location: string | null;
    }>`
      SELECT DISTINCT ON (vehicle_id)
        vehicle_id,
        time   AS last_seen,
        speed,
        battery_level,
        temperature,
        ST_AsGeoJSON(location)::jsonb AS location
      FROM vehicle_telemetry
      WHERE time > NOW() - (${windowHours} || ' hours')::interval
      ORDER BY vehicle_id, time DESC
    `.execute(this.db.db).then(r => r.rows);
  }

  // ── HYPERTABLE STATS (TimescaleDB introspection) ──────────────────────────
  /**
   * Returns TimescaleDB chunk + compression metadata for the hypertable.
   * Great for a /health or /admin endpoint to verify the extension is active.
   */
  async hypertableStats() {
    const chunks = await sql<{
      chunk_name: string;
      range_start: string;
      range_end: string;
      is_compressed: boolean;
    }>`
      SELECT
        chunk_name,
        range_start::text,
        range_end::text,
        is_compressed
      FROM timescaledb_information.chunks
      WHERE hypertable_name = 'vehicle_telemetry'
      ORDER BY range_start DESC
      LIMIT 20
    `.execute(this.db.db).then(r => r.rows);

    const [compression] = await sql<{
      total_chunks: number;
      compressed_chunks: number;
      compression_ratio: number;
    }>`
      SELECT
        COUNT(*)                                     AS total_chunks,
        COUNT(*) FILTER (WHERE is_compressed = true) AS compressed_chunks,
        ROUND(
          COUNT(*) FILTER (WHERE is_compressed = true)::numeric
          / NULLIF(COUNT(*), 0) * 100,
          1
        )                                            AS compression_ratio
      FROM timescaledb_information.chunks
      WHERE hypertable_name = 'vehicle_telemetry'
    `.execute(this.db.db).then(r => r.rows);

    return { compression, chunks };
  }
}