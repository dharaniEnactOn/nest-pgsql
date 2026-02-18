import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  ParseFloatPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import {
  DriverRow,
  NearbyDriverRow,
  DriverNameMatch,
  DriverDistance,
} from './driver.types';

@ApiTags('Drivers')
@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  // ── POST /drivers ────────────────────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new driver',
    description:
      'Creates a driver record. The optional `location` is stored as a ' +
      'PostGIS GEOGRAPHY(POINT, 4326) using ST_MakePoint.',
  })
  @ApiCreatedResponse({ description: 'Driver created successfully.' })
  create(@Body() dto: CreateDriverDto): Promise<DriverRow> {
    return this.driversService.create(dto);
  }

  // ── GET /drivers ─────────────────────────────────────────────────────────────
  @Get()
  @ApiOperation({
    summary: 'List all drivers',
    description:
      'Returns all drivers with their GeoJSON location. ' +
      'Filter by `status` to see only online/offline/busy drivers.',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['online', 'offline', 'busy'] })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiOkResponse({ description: 'List of drivers.' })
  findAll(
    @Query('status') status?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ): Promise<DriverRow[]> {
    return this.driversService.findAll(status, +limit, +offset);
  }

  // ── GET /drivers/nearby ───────────────────────────────────────────────────────
  @Get('nearby')
  @ApiOperation({
    summary: 'Find drivers within a radius (PostGIS ST_DWithin)',
    description:
      'Uses `ST_DWithin` on the `GEOGRAPHY(POINT)` column with the GIST index ' +
      'to efficiently find all drivers within `radius_m` metres of the given ' +
      'coordinate. Results are sorted by ascending distance (closest first).',
  })
  @ApiQuery({ name: 'lat', required: true, example: 37.7749 })
  @ApiQuery({ name: 'lon', required: true, example: -122.4194 })
  @ApiQuery({ name: 'radius_m', required: false, example: 5000 })
  @ApiQuery({ name: 'status', required: false, enum: ['online', 'offline', 'busy'] })
  @ApiOkResponse({ description: 'Nearby drivers with distance_m field.' })
  findNearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lon', ParseFloatPipe) lon: number,
    @Query('radius_m') radiusM = '5000',
    @Query('status') status?: string,
  ): Promise<NearbyDriverRow[]> {
    return this.driversService.findNearby(lat, lon, +radiusM, status);
  }

  // ── GET /drivers/search ───────────────────────────────────────────────────────
  @Get('search')
  @ApiOperation({
    summary: 'Fuzzy name search (pg_trgm similarity)',
    description:
      'Typo-tolerant search over driver names using `pg_trgm` `similarity()`. ' +
      'Useful for dispatcher lookups. Returns results above a 0.15 threshold.',
  })
  @ApiQuery({ name: 'q', required: true, example: 'Alic' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiOkResponse({ description: 'Matched drivers with similarity score.' })
  searchByName(
    @Query('q') q: string,
    @Query('limit') limit = '10',
  ): Promise<DriverNameMatch[]> {
    return this.driversService.searchByName(q, +limit);
  }

  // ── GET /drivers/:id ──────────────────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: 'Get a single driver by ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Driver record.' })
  @ApiNotFoundResponse({ description: 'Driver not found.' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<DriverRow> {
    return this.driversService.findOne(id);
  }

  // ── PATCH /drivers/:id ────────────────────────────────────────────────────────
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a driver (name, status, or location)',
    description:
      'Partial update — only provided fields are changed. ' +
      'Updating `location` rebuilds the PostGIS GEOGRAPHY column via ST_MakePoint.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Updated driver record.' })
  @ApiNotFoundResponse({ description: 'Driver not found.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDriverDto,
  ): Promise<DriverRow> {
    return this.driversService.update(id, dto);
  }

  // ── PATCH /drivers/:id/location ───────────────────────────────────────────────
  @Patch(':id/location')
  @ApiOperation({
    summary: 'GPS ping — update driver location only',
    description:
      'Lightweight endpoint designed for frequent GPS pings from driver apps. ' +
      'Updates only the `location` GEOGRAPHY column, returning the new position ' +
      'as GeoJSON.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiQuery({ name: 'lat', required: true, example: 37.78 })
  @ApiQuery({ name: 'lon', required: true, example: -122.41 })
  @ApiOkResponse({ description: 'Driver with updated location.' })
  @ApiNotFoundResponse({ description: 'Driver not found.' })
  updateLocation(
    @Param('id', ParseIntPipe) id: number,
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lon', ParseFloatPipe) lon: number,
  ): Promise<DriverRow> {
    return this.driversService.updateLocation(id, lat, lon);
  }

  // ── GET /drivers/distance/:a/:b ───────────────────────────────────────────────
  @Get('distance/:a/:b')
  @ApiOperation({
    summary: 'Distance between two drivers (PostGIS ST_Distance)',
    description:
      'Computes the geodesic distance in metres between the current locations ' +
      'of two drivers. Uses `ST_Distance` on GEOGRAPHY columns which accounts ' +
      'for Earth\'s curvature.',
  })
  @ApiParam({ name: 'a', type: Number, description: 'Driver A ID' })
  @ApiParam({ name: 'b', type: Number, description: 'Driver B ID' })
  @ApiOkResponse({ description: 'Distance in metres between the two drivers.' })
  @ApiNotFoundResponse({ description: 'One or both drivers have no location.' })
  distanceBetween(
    @Param('a', ParseIntPipe) a: number,
    @Param('b', ParseIntPipe) b: number,
  ): Promise<DriverDistance> {
    return this.driversService.distanceBetween(a, b);
  }

  // ── DELETE /drivers/:id ───────────────────────────────────────────────────────
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a driver' })
  @ApiParam({ name: 'id', type: Number })
  @ApiOkResponse({ description: 'Driver deleted.' })
  @ApiNotFoundResponse({ description: 'Driver not found.' })
  remove(@Param('id', ParseIntPipe) id: number): Promise<{ message: string; id: number }> {
    return this.driversService.remove(id);
  }
}