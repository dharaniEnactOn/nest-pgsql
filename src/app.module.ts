import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [DatabaseModule, InventoryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
