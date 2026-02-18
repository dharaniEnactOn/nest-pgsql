// src/drivers/driver.types.ts
// Shared types for the Drivers module.
// Interfaces must live here (not in drivers.service.ts) so that the
// controller can import them without hitting TS4053
// ("return type ... cannot be named").

export interface DriverLocation {
  type: string;
  coordinates: [number, number]; // [longitude, latitude]
}

export interface DriverRow {
  id: number;
  name: string;
  status: string;
  location: DriverLocation | null;
}

export interface NearbyDriverRow extends DriverRow {
  distance_m: number;
}

export interface DriverNameMatch extends DriverRow {
  similarity: number;
}

export interface DriverDistance {
  driver_a: number;
  driver_b: number;
  distance_m: number;
}