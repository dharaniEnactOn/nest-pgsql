import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { InventoryModule } from './inventory/inventory.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { DriversModule } from './drivers/drivers.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [DatabaseModule, InventoryModule, TelemetryModule, DriversModule, OrdersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
