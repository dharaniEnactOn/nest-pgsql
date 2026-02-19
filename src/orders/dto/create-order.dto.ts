import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsObject } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ example: 'customer-uuid-123', description: 'Customer identifier' })
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @ApiProperty({ example: 'driver-uuid-456', description: 'Assigned driver identifier' })
  @IsString()
  @IsNotEmpty()
  driverId: string;

  @ApiProperty({ example: 'item-uuid-789', description: 'Inventory item identifier' })
  @IsString()
  @IsNotEmpty()
  inventoryId: string;

  @ApiProperty({ example: 3, description: 'Quantity of items ordered' })
  @IsNumber()
  @IsPositive()
  quantity: number;

  @ApiPropertyOptional({
    example: { deliveryAddress: '123 Main St', priority: 'high' },
    description: 'Additional order metadata',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}