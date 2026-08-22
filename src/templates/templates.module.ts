import { Module } from '@nestjs/common';

import { MetricsModule } from '../metrics/metrics.module';
import { TemplateController } from './template.controller';
import { TemplateRepository } from './template.repository';
import { TemplateService } from './template.service';

@Module({
  imports: [MetricsModule],
  controllers: [TemplateController],
  providers: [TemplateRepository, TemplateService],
  exports: [TemplateRepository],
})
export class TemplatesModule {}
