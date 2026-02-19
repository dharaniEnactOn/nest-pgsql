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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import type { OrderStatus } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ────────────────────────────────────────────────
  // POST /orders  — create + enqueue
  // ────────────────────────────────────────────────
  @Post()
  @ApiOperation({
    summary: 'Place a new order',
    description:
      'Persists the order in PostgreSQL, then publishes it to the RabbitMQ `orders_queue`. ' +
      'The returned status will be `queued` when the broker is reachable, or `pending` when offline.',
  })
  @ApiResponse({ status: 201, description: 'Order created and enqueued.' })
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  // ────────────────────────────────────────────────
  // GET /orders
  // ────────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List all orders', description: 'Optionally filter by status.' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'queued', 'processing', 'completed', 'failed'],
  })
  findAll(@Query('status') status?: OrderStatus) {
    return this.ordersService.findAll(status);
  }

  // ────────────────────────────────────────────────
  // GET /orders/queue-stats  — RabbitMQ health
  // ────────────────────────────────────────────────
  @Get('queue-stats')
  @ApiOperation({
    summary: 'RabbitMQ queue statistics',
    description: 'Returns message count and consumer count from the live RabbitMQ queue.',
  })
  @ApiResponse({ status: 200, description: 'Queue stats returned.' })
  @ApiResponse({ status: 200, description: 'null when broker is offline.' })
  queueStats() {
    return this.ordersService.queueStats();
  }

  // ────────────────────────────────────────────────
  // GET /orders/:id
  // ────────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: 'Get a single order by ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 404, description: 'Order not found.' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOne(id);
  }

  // ────────────────────────────────────────────────
  // PATCH /orders/:id
  // ────────────────────────────────────────────────
  @Patch(':id')
  @ApiOperation({ summary: 'Update order fields' })
  @ApiParam({ name: 'id', type: Number })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto) {
    return this.ordersService.update(id, dto);
  }

  // ────────────────────────────────────────────────
  // PATCH /orders/:id/status  — worker callback
  // ────────────────────────────────────────────────
  @Patch(':id/status')
  @ApiOperation({
    summary: 'Update order status',
    description:
      'Called by workers (or manually) to transition an order through its lifecycle: ' +
      'pending → queued → processing → completed | failed.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiQuery({ name: 'value', enum: ['pending', 'queued', 'processing', 'completed', 'failed'] })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Query('value') status: OrderStatus,
  ) {
    return this.ordersService.updateStatus(id, status);
  }

  // ────────────────────────────────────────────────
  // DELETE /orders/:id
  // ────────────────────────────────────────────────
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an order' })
  @ApiParam({ name: 'id', type: Number })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.remove(id);
  }
}