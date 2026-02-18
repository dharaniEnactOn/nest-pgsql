## 🕒 Telemetry Module — Implementation Notes

> **Last updated:** February 2026  
> **Files changed:** `src/telemetry/**`

### What was implemented

The telemetry resource is now fully wired to the `vehicle_telemetry` **TimescaleDB hypertable** defined in `migrations/001_init_extensions.sql`. All stub methods have been replaced with real Kysely / raw-SQL queries that exercise the installed pg_extensions directly.

### Extensions used

| Extension | How it is used |
|:---|:---|
| **timescaledb** (2.24.0) | `vehicle_telemetry` is a hypertable partitioned on `time`. `time_bucket()` is used for the `/aggregate` endpoint. `timescaledb_information.chunks` is introspected by `/stats`. Compression + retention policies were set in the migration. |
| **postgis** (3.6.2) | The `location` column is `GEOGRAPHY(POINT, 4326)`. On write, `ST_MakePoint + ST_SetSRID` builds the geometry. On read, `ST_AsGeoJSON()` serialises it back to `{ type, coordinates }` JSON. |
| **pg_cron** (1.6) | TimescaleDB internally registers its compression and retention background jobs through `pg_cron`. No manual cron setup required for the 7-day compression policy. |

### Endpoints

| Method | Path | Description |
|:---|:---|:---|
| `POST` | `/telemetry` | Ingest one reading into the hypertable |
| `GET` | `/telemetry` | List rows, ordered by time DESC (paginated, optional `?vehicle_id=`) |
| `GET` | `/telemetry/fleet` | Latest snapshot per vehicle (`?window_hours=24`) |
| `GET` | `/telemetry/stats` | TimescaleDB chunk & compression metadata |
| `GET` | `/telemetry/:vehicle_id/latest` | Most-recent row for one vehicle |
| `GET` | `/telemetry/:vehicle_id/aggregate` | `time_bucket()` averages (`?bucket=1 hour&from=...&to=...`) |

### Key design decisions

**No UPDATE / DELETE on the hypertable.** Telemetry data is append-only by nature; TimescaleDB's compression model also makes point updates costly. If a correction is needed, insert a new corrected row with the original timestamp.

**Location serialised as GeoJSON.** The PostGIS `GEOGRAPHY` column is opaque to Kysely's type system, so `ST_AsGeoJSON()::jsonb` is used on every SELECT. This returns a standard GeoJSON `Point` object that clients can pass directly to mapping libraries.

**`time` defaults to `NOW()`.** If the caller omits `time` in the DTO, the service inserts `new Date()` (server clock). For high-volume IoT ingestion you should send the device timestamp explicitly.

**`hypertableStats()` for ops visibility.** The `/telemetry/stats` endpoint exposes chunk metadata so you can confirm compression is running without connecting to the database directly.

### Testing via Swagger

```
POST /telemetry
{
  "vehicle_id": "vehicle-abc-123",
  "speed": 65.2,
  "battery_level": 92.0,
  "temperature": 21.5,
  "location": { "lat": 23.0225, "lon": 72.5714 }
}

GET /telemetry/vehicle-abc-123/aggregate?bucket=15 minutes&from=2025-02-17T00:00:00Z

GET /telemetry/fleet?window_hours=6

GET /telemetry/stats
```