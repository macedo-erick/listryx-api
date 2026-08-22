import { Module } from '@nestjs/common';

import { InsightController } from './insight.controller';
import { InsightRepository } from './insight.repository';

@Module({
  controllers: [InsightController],
  providers: [InsightRepository],
  exports: [InsightRepository],
})
export class InsightsModule {}
