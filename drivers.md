# Drivers Module — Implementation Notes

> **Last updated:** February 2026
> **Files changed:** `src/drivers/**`

## What was implemented

The drivers module is now fully wired to the `drivers` table defined in `migrations/001_init_extensions.sql`. All scaffold stubs have been replaced with real PostGIS-powered SQL queries using Kysely's `sql` tag, following the same patterns established by the `telemetry` module.

---

## Extensions Used

| Extension | How it is used |
|:---|:---|
| **postgis** (3.6.2) | `drivers.location` is `GEOGRAPHY(POINT, 4326)`. `ST_MakePoint + ST_SetSRID` builds the geometry on write. `ST_AsGeoJSON()` serialises it back to a GeoJSON `Point` on read. `ST_DWithin` powers proximity search with GIST index support. `ST_Distance` computes geodesic distance between two driver locations. |
| **pg_trgm** (1.6) | `similarity(name, query)` powers the `/drivers/search` fuzzy-name endpoint — useful for dispatcher lookups with potential typos. |

---

## Database Schema (defined in migration)

```sql
CREATE TABLE IF NOT EXISTS drivers (
    id       SERIAL       PRIMARY KEY,
    name     TEXT         NOT NULL,
    location GEOGRAPHY(POINT, 4326),
    status   TEXT         DEFAULT 'offline'  -- online | offline | busy
);

CREATE INDEX IF NOT EXISTS idx_drivers_location ON drivers USING GIST (location);
```

The `GIST` index is what makes `ST_DWithin` fast — PostGIS can use it to prune the search space before computing exact distances.

---

## File Structure

```
src/drivers/
├── drivers.module.ts          # NestJS module wiring (imports DatabaseModule)
├── drivers.controller.ts      # REST endpoints + Swagger decorators
├── drivers.service.ts         # All DB logic via Kysely sql`` tag
└── dto/
    ├── create-driver.dto.ts   # name, location { lat, lon }, status
    └── update-driver.dto.ts   # PartialType of CreateDriverDto
```

---

## API Endpoints

| Method | Path | Description |
|:---|:---|:---|
| `POST` | `/drivers` | Register a new driver |
| `GET` | `/drivers` | List all drivers (optional `?status=` filter) |
| `GET` | `/drivers/nearby` | Find drivers within a radius using `ST_DWithin` |
| `GET` | `/drivers/search` | Fuzzy name search via `pg_trgm similarity()` |
| `GET` | `/drivers/:id` | Fetch a single driver |
| `PATCH` | `/drivers/:id` | Update name, status, and/or location |
| `PATCH` | `/drivers/:id/location` | GPS ping — update location only |
| `GET` | `/drivers/distance/:a/:b` | Geodesic distance between two drivers via `ST_Distance` |
| `DELETE` | `/drivers/:id` | Delete a driver |

---

## Endpoint Details

### `POST /drivers`
Creates a driver. If `location` is provided it is stored as a `GEOGRAPHY(POINT)` via `ST_MakePoint(lon, lat)`.

```json
{
  "name": "Alice Chen",
  "location": { "lat": 37.7749, "lon": -122.4194 },
  "status": "online"
}
```

---

### `GET /drivers/nearby`
The core PostGIS endpoint. Uses `ST_DWithin` to query all drivers within `radius_m` metres of a coordinate, then orders by `ST_Distance` ascending so the closest driver is always first.

```
GET /drivers/nearby?lat=37.7749&lon=-122.4194&radius_m=3000&status=online
```

The GIST index on `location` means this never does a full-table scan — PostGIS uses the spatial index to prune candidates before exact distance evaluation.

---

### `PATCH /drivers/:id/location`
Designed for high-frequency GPS pings from driver apps. Updates only the `location` column without loading the full row. Query params keep the body empty for minimal payload size.

```
PATCH /drivers/42/location?lat=37.7812&lon=-122.4102
```

---

### `GET /drivers/distance/:a/:b`
Computes the real-world geodesic distance between two drivers using `ST_Distance` on `GEOGRAPHY` columns. Because the column type is `GEOGRAPHY` (not `GEOMETRY`), PostGIS automatically uses spheroidal calculations that account for Earth's curvature — no manual projection needed.

```
GET /drivers/distance/1/2
→ { "driver_a": 1, "driver_b": 2, "distance_m": 1432 }
```

---

### `GET /drivers/search?q=`
Trigram similarity search over driver names. Threshold is `0.15` to catch single-character typos and abbreviations. Returns a `similarity` score alongside each row.

```
GET /drivers/search?q=Alic
→ [{ "id": 1, "name": "Alice Chen", "similarity": 0.36, ... }]
```

---

## Key Design Decisions

**Location stored as `GEOGRAPHY`, not `GEOMETRY`.** Using `GEOGRAPHY(POINT, 4326)` means all distance calculations (`ST_Distance`, `ST_DWithin`) are automatically in metres on a spheroidal Earth model. No need to manage projections or CRS conversions in application code.

**`ST_AsGeoJSON()::jsonb` on every SELECT.** The PostGIS `GEOGRAPHY` column is opaque to Kysely's type system. Casting to `::jsonb` via `ST_AsGeoJSON` returns a standards-compliant GeoJSON `Point` object that mapping libraries (Mapbox, Leaflet, deck.gl) can consume directly.

**GPS ping as a separate PATCH endpoint.** The `/drivers/:id/location` endpoint only updates one column, avoiding unnecessary writes to `name` or `status`. In a real deployment this endpoint would receive hundreds of pings per minute per vehicle.

**`ST_DWithin` with GIST index.** Always preferred over `ST_Distance < radius` in the `WHERE` clause. `ST_DWithin` can use the spatial index; a bare `ST_Distance` comparison cannot.

**`pg_trgm` fuzzy search on names.** Dispatcher UIs often involve imprecise name lookups. The existing GIN trigram index on `inventory.name` demonstrates the pattern; the drivers service applies the same `similarity()` approach for driver name search.

---

## Testing via Swagger

```
# 1. Create drivers (matches migration seed data pattern)
POST /drivers
{ "name": "Alice Chen", "location": { "lat": 37.7749, "lon": -122.4194 }, "status": "online" }

POST /drivers
{ "name": "Bob Okafor", "location": { "lat": 37.7849, "lon": -122.4094 }, "status": "online" }

# 2. Find nearby online drivers within 2 km
GET /drivers/nearby?lat=37.78&lon=-122.41&radius_m=2000&status=online

# 3. GPS ping
PATCH /drivers/1/location?lat=37.7812&lon=-122.4102

# 4. Distance between two drivers
GET /drivers/distance/1/2

# 5. Fuzzy name lookup
GET /drivers/search?q=Alic
```