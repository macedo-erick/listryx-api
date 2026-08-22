import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { CONFIG, type Config } from './config';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ConfigModule } from './config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { InsightsModule } from './insights/insights.module';
import { ListsModule } from './lists/lists.module';
import { loggerOptions } from './logging';
import { MeModule } from './me/me.module';
import { HttpMetricsMiddleware } from './metrics/http-metrics.middleware';
import { MetricsModule } from './metrics/metrics.module';
import { TemplatesModule } from './templates/templates.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [CONFIG],
      useFactory: (config: Config) => loggerOptions(config),
    }),
    DatabaseModule,
    MetricsModule,
    HealthModule,
    TemplatesModule,
    InsightsModule,
    ListsModule,
    MeModule,
  ],
  providers: [HttpMetricsMiddleware, { provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
