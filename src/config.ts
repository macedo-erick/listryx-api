import { z } from 'zod';

const schema = z.object({
  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5434),
  POSTGRES_DB: z.string().min(1).default('listryx'),
  POSTGRES_USER: z.string().min(1).default('listryx'),
  POSTGRES_PASSWORD: z.string().min(1).default('listryx'),

  HTTP_HOST: z.string().min(1).default('127.0.0.1'),
  HTTP_PORT: z.coerce.number().int().positive().default(8088),

  KEYCLOAK_ISSUER_URI: z.url().default('http://localhost:8089/auth/realms/listryx'),
  KEYCLOAK_JWKS_URI: z.url().optional(),

  // Verifying tokens the UI presents is KEYCLOAK_ISSUER_URI above; this is the other direction,
  // the API calling Keycloak's Admin API on its own behalf to read and edit /me.
  KEYCLOAK_SERVER_URL: z.url().default('http://localhost:8089/auth'),
  KEYCLOAK_REALM: z.string().min(1).default('listryx'),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).default('listryx-api-admin'),
  KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1).default('local-dev-secret'),

  LISTRYX_CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
    ),

  LISTRYX_DEFAULT_CURRENCY: z.string().length(3).default('BRL'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
});

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new ConfigError(`Invalid environment configuration:\n${detail}`);
  }

  return result.data;
}

export function databaseUrl(config: Config): string {
  const { DB_HOST, DB_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD } = config;
  const credentials = `${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}`;

  return `postgres://${credentials}@${DB_HOST}:${String(DB_PORT)}/${POSTGRES_DB}`;
}

export function jwksUri(config: Config): URL {
  if (config.KEYCLOAK_JWKS_URI !== undefined) {
    return new URL(config.KEYCLOAK_JWKS_URI);
  }

  return new URL(`${config.KEYCLOAK_ISSUER_URI}/protocol/openid-connect/certs`);
}

export const CONFIG = Symbol('LISTRYX_CONFIG');
