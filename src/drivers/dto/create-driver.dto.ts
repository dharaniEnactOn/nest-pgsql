import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LocationDto {
    @ApiProperty({ example: 37.7749, description: 'Latitude' })
    lat: number;

    @ApiProperty({ example: -122.4194, description: 'Longitude' })
    lon: number;
}

export class CreateDriverDto {
    @ApiProperty({ example: 'Alice Chen', description: 'Full name of the driver' })
    name: string;

    @ApiPropertyOptional({
        description: 'Current GPS location of the driver',
        example: { lat: 37.7749, lon: -122.4194 },
        type: () => LocationDto,
    })
    location?: LocationDto;

    @ApiPropertyOptional({
        enum: ['online', 'offline', 'busy'],
        default: 'offline',
        description: 'Driver availability status',
    })
    status?: 'online' | 'offline' | 'busy';
}