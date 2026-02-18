import { Injectable } from '@nestjs/common';
import { CreateTelemetryDto } from './dto/create-telemetry.dto';
import { UpdateTelemetryDto } from './dto/update-telemetry.dto';

@Injectable()
export class TelemetryService {
  create(createTelemetryDto: CreateTelemetryDto) {
    return 'This action adds a new telemetry';
  }

  findAll() {
    return `This action returns all telemetry`;
  }

  findOne(id: number) {
    return `This action returns a #${id} telemetry`;
  }

  update(id: number, updateTelemetryDto: UpdateTelemetryDto) {
    return `This action updates a #${id} telemetry`;
  }

  remove(id: number) {
    return `This action removes a #${id} telemetry`;
  }
}
