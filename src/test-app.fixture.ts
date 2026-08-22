import { randomUUID } from 'node:crypto';

import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { inject } from 'vitest';

import { AppModule } from './app.module';
import { JwtGuard } from './auth/jwt.guard';
import { CONFIG, type Config, loadConfig } from './config';
import { DATABASE, type Database, createDatabase } from './database/db';
import { MIGRATIONS_FOLDER } from './database/migrate';

export class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const sub = request.headers['x-test-owner'];

    if (typeof sub !== 'string') {
      return false;
    }

    request.user = { sub };

    return true;
  }
}

export interface ApiResult<T> {
  readonly status: number;
  readonly body: T;
}

export async function call<T>(
  harness: TestHarness,
  owner: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const response = await fetch(`${harness.url}${path}`, {
    method,
    headers: {
      'x-test-owner': owner,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();

  return {
    status: response.status,
    body: (text === '' ? undefined : JSON.parse(text)) as T,
  };
}

export interface TestHarness {
  readonly app: INestApplication;
  readonly db: Database;
  readonly url: string;
  newOwner(): string;
  close(): Promise<void>;
}

export async function startTestApp(): Promise<TestHarness> {
  const databaseUrl = inject('databaseUrl');
  const config = configFor(databaseUrl);

  const migrator = createDatabase(databaseUrl, { max: 1, quiet: true });
  await migrate(migrator.db, { migrationsFolder: MIGRATIONS_FOLDER });
  await migrator.close();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG)
    .useValue(config)
    .overrideGuard(JwtGuard)
    .useClass(FakeAuthGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'metrics'] });
  await app.init();
  await app.listen(0);

  return {
    app,
    db: app.get<Database>(DATABASE),
    url: await app.getUrl(),
    newOwner: () => randomUUID(),
    close: () => app.close(),
  };
}

function configFor(databaseUrl: string): Config {
  const parsed = new URL(databaseUrl);

  return {
    ...loadConfig({}),
    DB_HOST: parsed.hostname,
    DB_PORT: Number(parsed.port),
    POSTGRES_DB: parsed.pathname.slice(1),
    POSTGRES_USER: decodeURIComponent(parsed.username),
    POSTGRES_PASSWORD: decodeURIComponent(parsed.password),
    LOG_LEVEL: 'error' as const,
  };
}
