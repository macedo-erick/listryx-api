import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { ProfileResponse } from './dto';

type User = Record<string, unknown>;

interface Keycloak {
  readonly server: Server;
  readonly url: string;
  users: Map<string, User>;
  takenEmails: Set<string>;
  failNext: number | null;
  tokenRequests: number;
  adminAuthorizations: string[];
}

let harness: TestHarness;
let keycloak: Keycloak;

const REALM = 'listryx';

async function readJson(request: import('node:http').IncomingMessage): Promise<User> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString() || '{}') as User;
}

async function startKeycloak(): Promise<Keycloak> {
  // One object, not a copy: the tests flip `failNext` and read `tokenRequests` on what the
  // handler closes over.
  const state: Omit<Keycloak, 'server' | 'url'> = {
    users: new Map<string, User>(),
    takenEmails: new Set<string>(),
    failNext: null,
    tokenRequests: 0,
    adminAuthorizations: [],
  };

  const server = createServer((request, response) => {
    void (async () => {
      const path = (request.url ?? '').split('?')[0] ?? '';

      if (path === `/realms/${REALM}/protocol/openid-connect/token`) {
        state.tokenRequests += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ access_token: 'service-account-token', expires_in: 300 }));

        return;
      }

      const match = /^\/admin\/realms\/listryx\/users\/(?<id>[^/]+)$/.exec(path);

      if (match?.groups === undefined) {
        response.writeHead(404).end();

        return;
      }

      state.adminAuthorizations.push(request.headers.authorization ?? '');

      const failure = state.failNext;

      if (failure !== null) {
        state.failNext = null;
        response.writeHead(failure).end('boom');

        return;
      }

      const id = match.groups['id']!;
      const user = state.users.get(id);

      if (user === undefined) {
        response.writeHead(404).end();

        return;
      }

      if (request.method === 'PUT') {
        const attributes = await readJson(request);
        const email = attributes['email'];

        if (typeof email === 'string' && state.takenEmails.has(email.toLowerCase())) {
          response.writeHead(409, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ errorMessage: 'User exists with same email' }));

          return;
        }

        state.users.set(id, { ...user, ...attributes });
        response.writeHead(204).end();

        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(user));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as AddressInfo;

  return Object.assign(state, { server, url: `http://127.0.0.1:${String(port)}` });
}

function known(sub: string, user: User = {}): string {
  keycloak.users.set(sub, {
    username: 'erick',
    firstName: 'Erick',
    lastName: 'Macedo',
    email: 'erick@example.com',
    emailVerified: true,
    ...user,
  });

  return sub;
}

beforeAll(async () => {
  keycloak = await startKeycloak();
  harness = await startTestApp({
    config: { KEYCLOAK_SERVER_URL: keycloak.url, KEYCLOAK_REALM: REALM },
  });
});

afterAll(async () => {
  await harness.close();
  await new Promise<void>((resolve, reject) => {
    keycloak.server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
});

beforeEach(() => {
  keycloak.users.clear();
  keycloak.takenEmails.clear();
  keycloak.failNext = null;
  keycloak.adminAuthorizations.length = 0;
});

describe('reading the profile', () => {
  it('answers with the identity provider’s copy of the signed-in user', async () => {
    const owner = known(harness.newOwner());

    const profile = await call<ProfileResponse>(harness, owner, 'GET', '/api/me');

    expect(profile.status).toBe(200);
    expect(profile.body).toEqual({
      username: 'erick',
      firstName: 'Erick',
      lastName: 'Macedo',
      email: 'erick@example.com',
      emailVerified: true,
    });
  });

  it('reads a half-filled profile as empty strings rather than nulls', async () => {
    const owner = harness.newOwner();

    keycloak.users.set(owner, { username: 'sparse' });

    const profile = await call<ProfileResponse>(harness, owner, 'GET', '/api/me');

    expect(profile.body).toEqual({
      username: 'sparse',
      firstName: '',
      lastName: '',
      email: '',
      emailVerified: false,
    });
  });

  it('answers 404 when the identity provider has never heard of the subject', async () => {
    const stranger = await call(harness, harness.newOwner(), 'GET', '/api/me');

    expect(stranger.status).toBe(404);
  });

  it('hides an identity provider outage behind a plain 500', async () => {
    const owner = known(harness.newOwner());

    keycloak.failNext = 502;

    const broken = await call<{ message: string; error: string }>(harness, owner, 'GET', '/api/me');

    expect(broken.status).toBe(500);
    expect(broken.body.message).toBe('An unexpected error occurred');
  });
});

describe('editing the profile', () => {
  it('writes the new name and reads the profile back', async () => {
    const owner = known(harness.newOwner());

    const updated = await call<ProfileResponse>(harness, owner, 'PUT', '/api/me', {
      firstName: 'Erick',
      lastName: 'Souza',
      email: 'erick@example.com',
    });

    expect(updated.status).toBe(200);
    expect(updated.body.lastName).toBe('Souza');
    expect(keycloak.users.get(owner)?.['lastName']).toBe('Souza');
  });

  it('drops the verified flag when the address itself changes', async () => {
    const owner = known(harness.newOwner());

    const updated = await call<ProfileResponse>(harness, owner, 'PUT', '/api/me', {
      firstName: 'Erick',
      lastName: 'Macedo',
      email: 'new@example.com',
    });

    expect(updated.body.email).toBe('new@example.com');
    expect(updated.body.emailVerified).toBe(false);
  });

  it('keeps the verified flag when only the casing of the address changed', async () => {
    const owner = known(harness.newOwner());

    const updated = await call<ProfileResponse>(harness, owner, 'PUT', '/api/me', {
      firstName: 'Erick',
      lastName: 'Macedo',
      email: 'ERICK@example.com',
    });

    expect(updated.body.emailVerified).toBe(true);
  });

  it('takes an omitted last name as clearing it', async () => {
    const owner = known(harness.newOwner());

    const updated = await call<ProfileResponse>(harness, owner, 'PUT', '/api/me', {
      firstName: 'Erick',
      email: 'erick@example.com',
    });

    expect(updated.status).toBe(200);
    expect(updated.body.lastName).toBe('');
  });

  it('answers 409 when the address belongs to someone else', async () => {
    const owner = known(harness.newOwner());

    keycloak.takenEmails.add('taken@example.com');

    const conflict = await call<{ message: string }>(harness, owner, 'PUT', '/api/me', {
      firstName: 'Erick',
      lastName: 'Macedo',
      email: 'taken@example.com',
    });

    expect(conflict.status).toBe(409);
    expect(conflict.body.message).toBe('That email address is already in use');
    expect(keycloak.users.get(owner)?.['email']).toBe('erick@example.com');
  });

  it('rejects a malformed address and a blank first name before calling out', async () => {
    const owner = known(harness.newOwner());

    const badEmail = await call<{ message: string }>(harness, owner, 'PUT', '/api/me', {
      firstName: 'Erick',
      email: 'not-an-email',
    });
    const blankName = await call(harness, owner, 'PUT', '/api/me', {
      firstName: '  ',
      email: 'erick@example.com',
    });

    expect(badEmail.status).toBe(400);
    expect(badEmail.body.message).toContain('email');
    expect(blankName.status).toBe(400);
    expect(keycloak.adminAuthorizations).toHaveLength(0);
  });
});

describe('the service-account token', () => {
  it('is sent as a bearer token and reused across calls', async () => {
    const owner = known(harness.newOwner());

    await call(harness, owner, 'GET', '/api/me');

    const before = keycloak.tokenRequests;

    await call(harness, owner, 'GET', '/api/me');
    await call(harness, owner, 'GET', '/api/me');

    expect(keycloak.tokenRequests).toBe(before);
    expect(keycloak.adminAuthorizations).toEqual([
      'Bearer service-account-token',
      'Bearer service-account-token',
      'Bearer service-account-token',
    ]);
  });
});
