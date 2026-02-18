import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { TelemetryService } from './telemetry.service';
import { CreateTelemetryDto } from './dto/create-telemetry.dto';

@ApiTags('Telemetry')
@Controller('telemetry')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  // ── POST /telemetry ────────────────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ingest a telemetry reading',
    description:
      'Inserts one sensor snapshot into the TimescaleDB hypertable. ' +
      'The optional `location` field is stored as a PostGIS GEOGRAPHY(POINT).',
  })
  @ApiCreatedResponse({ description: 'Reading ingested successfully.' })
  create(@Body() dto: CreateTelemetryDto) {
    return this.telemetryService.create(dto);
  }

  // ── GET /telemetry ─────────────────────────────────────────────────────────
  @Get()
  @ApiOperation({
    summary: 'List recent telemetry readings',
    description:
      'Returns rows ordered by time DESC. TimescaleDB chunk-exclusion ' +
      'makes time-ordered scans extremely efficient.',
  })
  @ApiQuery({ name: 'vehicle_id', required: false, example: 'vehicle-abc-123' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiOkResponse({ description: 'Paginated list of telemetry rows.' })
  findAll(
    @Query('vehicle_id') vehicle_id?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    return this.telemetryService.findAll(vehicle_id, +limit, +offset);
  }

  // ── GET /telemetry/fleet ───────────────────────────────────────────────────
  @Get('fleet')
  @ApiOperation({
    summary: 'Fleet-wide summary (latest reading per vehicle)',
    description:
      'Uses DISTINCT ON to return the most-recent snapshot for every ' +
      'vehicle active within the given window. Ideal for a live dashboard.',
  })
  @ApiQuery({
    name: 'window_hours',
    required: false,
    example: 24,
    description: 'How many hours back to look for active vehicles.',
  })
  @ApiOkResponse({ description: 'One row per active vehicle.' })
  fleetSummary(@Query('window_hours') windowHours = '24') {
    return this.telemetryService.fleetSummary(+windowHours);
  }

  // ── GET /telemetry/stats ───────────────────────────────────────────────────
  @Get('stats')
  @ApiOperation({
    summary: 'TimescaleDB hypertable chunk & compression stats',
    description:
      'Introspects `timescaledb_information.chunks` to expose chunk count, ' +
      'compression ratio, and per-chunk time ranges. Useful for ops/health.',
  })
  @ApiOkResponse({ description: 'Hypertable chunk metadata.' })
  hypertableStats() {
    return this.telemetryService.hypertableStats();
  }

  // ── GET /telemetry/:vehicle_id/latest ─────────────────────────────────────
  @Get(':vehicle_id/latest')
  @ApiOperation({
    summary: 'Latest reading for a specific vehicle',
    description: 'Returns the single most-recent row from the hypertable for this vehicle.',
  })
  @ApiParam({ name: 'vehicle_id', example: 'vehicle-abc-123' })
  @ApiOkResponse({ description: 'Most recent telemetry snapshot.' })
  findLatest(@Param('vehicle_id') vehicle_id: string) {
    return this.telemetryService.findLatest(vehicle_id);
  }

  // ── GET /telemetry/:vehicle_id/aggregate ──────────────────────────────────
  @Get(':vehicle_id/aggregate')
  @ApiOperation({
    summary: 'Aggregate telemetry via TimescaleDB time_bucket()',
    description:
      'Groups readings into configurable time buckets (e.g. "1 hour", ' +
      '"15 minutes") and returns AVG speed, battery and temperature per bucket.',
  })
  @ApiParam({ name: 'vehicle_id', example: 'vehicle-abc-123' })
  @ApiQuery({
    name: 'bucket',
    required: false,
    example: '1 hour',
    description: "PostgreSQL interval string: '1 hour', '15 minutes', '1 day' …",
  })
  @ApiQuery({
    name: 'from',
    required: false,
    example: '2025-02-17T00:00:00Z',
    description: 'ISO-8601 start of the aggregation window.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    example: '2025-02-18T00:00:00Z',
    description: 'ISO-8601 end of the aggregation window.',
  })
  @ApiOkResponse({ description: 'Bucketed sensor averages.' })
  aggregate(
    @Param('vehicle_id') vehicle_id: string,
    @Query('bucket') bucket = '1 hour',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.telemetryService.aggregate(vehicle_id, bucket, from, to);
  }
}