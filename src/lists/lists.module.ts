import { Module } from '@nestjs/common';

import { InsightsModule } from '../insights/insights.module';
import { MetricsModule } from '../metrics/metrics.module';
import { TemplatesModule } from '../templates/templates.module';
import { ListItemController } from './list-item.controller';
import { ListController } from './list.controller';
import { ListRepository } from './list.repository';
import { ListService } from './list.service';

@Module({
  imports: [MetricsModule, TemplatesModule, InsightsModule],
  controllers: [ListController, ListItemController],
  providers: [ListRepository, ListService],
})
export class ListsModule {}
