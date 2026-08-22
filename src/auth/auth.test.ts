import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestHarness, startTestApp } from '../test-app.fixture';

interface Signer {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly jwk: JWK;
}

let harness: TestHarness;
let jwks: Server;
let issuer: string;
let signer: Signer;
let intruder: Signer;

async function newSigner(kid: string): Promise<Signer> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });

  return {
    kid,
    privateKey,
    jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' },
  };
}

async function tokenFor(
  sub: string | undefined,
  overrides: { issuer?: string; expiresIn?: string; signer?: Signer } = {},
): Promise<string> {
  const signing = overrides.signer ?? signer;
  const claims = new SignJWT(sub === undefined ? {} : { sub })
    .setProtectedHeader({ alg: 'RS256', kid: signing.kid })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? issuer)
    .setExpirationTime(overrides.expiresIn ?? '5m');

  return claims.sign(signing.privateKey);
}

async function get(path: string, authorization?: string): Promise<Response> {
  return fetch(`${harness.url}${path}`, {
    headers: authorization === undefined ? {} : { authorization },
  });
}

beforeAll(async () => {
  signer = await newSigner('test-key');
  intruder = await newSigner('other-key');

  jwks = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys: [signer.jwk] }));
  });

  await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));

  const { port } = jwks.address() as AddressInfo;

  issuer = `http://127.0.0.1:${String(port)}/realms/listryx`;
  harness = await startTestApp({
    realAuth: true,
    config: {
      KEYCLOAK_ISSUER_URI: issuer,
      KEYCLOAK_JWKS_URI: `http://127.0.0.1:${String(port)}/certs`,
    },
  });
});

afterAll(async () => {
  await harness.close();
  await new Promise<void>((resolve, reject) => {
    jwks.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
});

describe('a token the realm signed', () => {
  it('is accepted, and its subject is the owner the data is scoped to', async () => {
    const sub = randomUUID();
    const authorization = `Bearer ${await tokenFor(sub)}`;

    const created = await fetch(`${harness.url}/api/lists`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Signed in' }),
    });

    expect(created.status).toBe(201);

    const mine = await get('/api/lists', authorization);
    const theirs = await get('/api/lists', `Bearer ${await tokenFor(randomUUID())}`);

    expect(((await mine.json()) as { content: unknown[] }).content).toHaveLength(1);
    expect(((await theirs.json()) as { content: unknown[] }).content).toHaveLength(0);
  });

  it('is read case-insensitively from the scheme', async () => {
    const accepted = await get('/api/lists', `bearer ${await tokenFor(randomUUID())}`);

    expect(accepted.status).toBe(200);
  });
});

describe('a token the realm did not sign', () => {
  it('is refused when it is missing entirely', async () => {
    const anonymous = await get('/api/lists');

    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as { message: string }).message).toBe('Missing bearer token');
  });

  it('is refused when the scheme is not bearer, or the header is malformed', async () => {
    const basic = await get('/api/lists', 'Basic dXNlcjpwYXNz');
    const bare = await get('/api/lists', await tokenFor(randomUUID()));
    const extra = await get('/api/lists', `Bearer ${await tokenFor(randomUUID())} trailing`);

    expect(basic.status).toBe(401);
    expect(bare.status).toBe(401);
    expect(extra.status).toBe(401);
  });

  it('is refused when it is gibberish', async () => {
    const nonsense = await get('/api/lists', 'Bearer not.a.jwt');

    expect(nonsense.status).toBe(401);
    expect(((await nonsense.json()) as { message: string }).message).toBe('Invalid bearer token');
  });

  it('is refused when another key signed it', async () => {
    const forged = await get(
      '/api/lists',
      `Bearer ${await tokenFor(randomUUID(), { signer: intruder })}`,
    );

    expect(forged.status).toBe(401);
  });

  it('is refused when it came from another issuer', async () => {
    const elsewhere = await get(
      '/api/lists',
      `Bearer ${await tokenFor(randomUUID(), { issuer: 'http://elsewhere.example/realms/other' })}`,
    );

    expect(elsewhere.status).toBe(401);
  });

  it('is refused once it has expired', async () => {
    const stale = await get(
      '/api/lists',
      `Bearer ${await tokenFor(randomUUID(), { expiresIn: '-1m' })}`,
    );

    expect(stale.status).toBe(401);
  });

  it('is refused when it carries no subject to own anything', async () => {
    const anonymous = await get('/api/lists', `Bearer ${await tokenFor(undefined)}`);

    expect(anonymous.status).toBe(401);
  });
});

describe('what needs no token at all', () => {
  it('serves health and metrics to an unauthenticated caller', async () => {
    const health = await get('/health');
    const metrics = await get('/metrics');

    expect(health.status).toBe(200);
    expect(metrics.status).toBe(200);
  });
});
