import { Module } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

export const LISTS_CREATED = 'listryx_lists_created_total';
export const TEMPLATES_SAVED = 'listryx_templates_saved_total';
export const HTTP_REQUEST_DURATION = 'http_request_duration_seconds';

const metrics = [
  makeHistogramProvider({
    name: HTTP_REQUEST_DURATION,
    help: 'HTTP request latency, by route template and response status.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  }),
  makeCounterProvider({
    name: LISTS_CREATED,
    help: 'Lists created, by whether they started from a template or from scratch.',
    labelNames: ['source'],
  }),
  makeCounterProvider({
    name: TEMPLATES_SAVED,
    help: 'Templates saved, by whether they were built directly or lifted from a list.',
    labelNames: ['source'],
  }),
];

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultLabels: { app: 'listryx-api' },
    }),
  ],
  providers: metrics,
  exports: [PrometheusModule, ...metrics],
})
export class MetricsModule {}
