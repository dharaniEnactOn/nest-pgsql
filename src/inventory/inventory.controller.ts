import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // POST /inventory
  @Post()
  @ApiOperation({ summary: 'Create a new inventory item' })
  create(@Body() dto: CreateInventoryDto) {
    return this.inventoryService.create(dto);
  }

  // GET /inventory
  @Get()
  @ApiOperation({ summary: 'List all inventory items (paginated)' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  findAll(
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
  ) {
    return this.inventoryService.findAll(+limit, +offset);
  }

  // GET /inventory/search?q=headphones
  @Get('search')
  @ApiOperation({ summary: 'Full-text search using BM25 / tsvector' })
  @ApiQuery({ name: 'q', required: true, example: 'wireless headphones' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  search(
    @Query('q') q: string,
    @Query('limit') limit = '10',
  ) {
    return this.inventoryService.search(q, +limit);
  }

  // GET /inventory/fuzzy?q=hedphones
  @Get('fuzzy')
  @ApiOperation({ summary: 'Fuzzy / trigram search (typo-tolerant, pg_trgm)' })
  @ApiQuery({ name: 'q', required: true, example: 'hedphones' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  fuzzySearch(
    @Query('q') q: string,
    @Query('limit') limit = '10',
  ) {
    return this.inventoryService.fuzzySearch(q, +limit);
  }

  // GET /inventory/:id
  @Get(':id')
  @ApiOperation({ summary: 'Get a single inventory item by ID' })
  @ApiParam({ name: 'id', type: Number })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const item = await this.inventoryService.findOne(id);
    if (!item) throw new NotFoundException(`Inventory item ${id} not found`);
    return item;
  }

  // PUT /inventory/:id
  @Put(':id')
  @ApiOperation({ summary: 'Update an inventory item' })
  @ApiParam({ name: 'id', type: Number })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateInventoryDto>,
  ) {
    const item = await this.inventoryService.update(id, dto);
    if (!item) throw new NotFoundException(`Inventory item ${id} not found`);
    return item;
  }

  // DELETE /inventory/:id
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an inventory item' })
  @ApiParam({ name: 'id', type: Number })
  async remove(@Param('id', ParseIntPipe) id: number) {
    const item = await this.inventoryService.remove(id);
    if (!item) throw new NotFoundException(`Inventory item ${id} not found`);
    return { message: `Item "${item.name}" deleted`, id: item.id };
  }
}