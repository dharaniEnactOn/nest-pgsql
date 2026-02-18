import { PartialType } from '@nestjs/swagger';
import { CreateTelemetryDto } from './create-telemetry.dto';

export class UpdateTelemetryDto extends PartialType(CreateTelemetryDto) {}
