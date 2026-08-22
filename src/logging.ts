import type { Params } from 'nestjs-pino';

import type { Config } from './config';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  '*.password',
  'token',
  '*.token',
  'authorization',
  '*.authorization',
];

export type WriteEvent =
  | 'list.created'
  | 'list.renamed'
  | 'list.closed'
  | 'list.reopened'
  | 'list.deleted'
  | 'list.items_reordered'
  | 'list_item.added'
  | 'list_item.updated'
  | 'list_item.deleted'
  | 'template.created'
  | 'template.updated'
  | 'template.deleted'
  | 'template.saved_from_list';

export function loggerOptions(config: Config): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      autoLogging: {
        ignore: (request) => request.url === '/health' || request.url === '/metrics',
      },
      ...(config.LOG_PRETTY
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
  };
}
