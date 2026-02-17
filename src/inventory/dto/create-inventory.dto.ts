import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInventoryDto {
  @ApiProperty({ example: 'Wireless Headphones', description: 'Item name' })
  name: string;

  @ApiPropertyOptional({
    example: 'Noise-cancelling over-ear headphones with 30hr battery',
    description: 'Item description',
  })
  description?: string;

  @ApiPropertyOptional({
    example: { sku: 'WH-1000', category: 'electronics', price: 299.99 },
    description: 'Arbitrary JSONB metadata',
  })
  metadata?: Record<string, unknown>;
}