import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTelemetryDto {
    @ApiProperty({
        example: 'vehicle-abc-123',
        description: 'Unique vehicle identifier',
    })
    vehicle_id: string;

    @ApiPropertyOptional({
        example: 72.5,
        description: 'Vehicle speed in km/h',
    })
    speed?: number;

    @ApiPropertyOptional({
        example: 87.3,
        description: 'Battery level as a percentage (0–100)',
    })
    battery_level?: number;

    @ApiPropertyOptional({
        example: 23.1,
        description: 'Engine / ambient temperature in °C',
    })
    temperature?: number;

    @ApiPropertyOptional({
        example: { lat: 23.0225, lon: 72.5714 },
        description: 'Current GPS position ({ lat, lon }). Stored as PostGIS GEOGRAPHY(POINT).',
    })
    location?: { lat: number; lon: number };

    @ApiPropertyOptional({
        example: '2025-02-18T12:00:00Z',
        description:
            'ISO-8601 timestamp for the reading. Defaults to NOW() when omitted.',
    })
    time?: string;
}