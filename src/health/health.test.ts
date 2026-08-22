import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestHarness, call, startTestApp } from '../test-app.fixture';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp();
});

afterAll(async () => {
  await harness.close();
});

async function text(path: string): Promise<string> {
  const response = await fetch(`${harness.url}${path}`);

  expect(response.status).toBe(200);

  return response.text();
}

describe('health', () => {
  it('reports the database it can reach', async () => {
    const response = await fetch(`${harness.url}/health`);
    const body = (await response.json()) as {
      status: string;
      info: Record<string, { status: string }>;
      error: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.info['database']?.status).toBe('up');
    expect(body.error).toEqual({});
  });

  it('sits outside the api prefix', async () => {
    const prefixed = await fetch(`${harness.url}/api/health`);

    expect(prefixed.status).toBe(404);
  });
});

describe('metrics', () => {
  it('exposes the counters the app declares, labelled with the app name', async () => {
    const body = await text('/metrics');

    expect(body).toContain('listryx_lists_created_total');
    expect(body).toContain('listryx_templates_saved_total');
    expect(body).toContain('http_request_duration_seconds');
    expect(body).toContain('app="listryx-api"');
  });

  it('counts a list created from scratch apart from one created from a template', async () => {
    const owner = harness.newOwner();
    const template = await call<{ id: string }>(harness, owner, 'POST', '/api/templates', {
      name: 'Source',
      items: [{ text: 'leite' }],
    });

    await call(harness, owner, 'POST', '/api/lists', { name: 'From scratch' });
    await call(harness, owner, 'POST', '/api/lists', {
      name: 'From template',
      templateId: template.body.id,
    });

    const body = await text('/metrics');

    expect(body).toMatch(/listryx_lists_created_total\{[^}]*source="scratch"[^}]*\} [1-9]/);
    expect(body).toMatch(/listryx_lists_created_total\{[^}]*source="template"[^}]*\} [1-9]/);
    expect(body).toMatch(/listryx_templates_saved_total\{[^}]*source="scratch"[^}]*\} [1-9]/);
  });

  it('times requests by route template, so one series does not become one per list', async () => {
    const owner = harness.newOwner();
    const list = await call<{ id: string }>(harness, owner, 'POST', '/api/lists', {
      name: 'Timed',
    });

    await call(harness, owner, 'GET', `/api/lists/${list.body.id}`);
    await call(harness, owner, 'GET', `/api/lists/${list.body.id}`);

    const body = await text('/metrics');
    const series = body
      .split('\n')
      .filter((line) => line.startsWith('http_request_duration_seconds_count'));

    expect(series.some((line) => line.includes('status_code="200"'))).toBe(true);
    expect(series.some((line) => line.includes(list.body.id))).toBe(false);
  });

  it('leaves its own endpoint and health uncounted', async () => {
    await text('/health');
    await text('/metrics');

    const body = await text('/metrics');
    const counted = body
      .split('\n')
      .filter((line) => line.startsWith('http_request_duration_seconds_count'));

    expect(counted.some((line) => line.includes('route="/health"'))).toBe(false);
    expect(counted.some((line) => line.includes('route="/metrics"'))).toBe(false);
  });

  it('counts a rejected request too, since a 401 never reaches an interceptor', async () => {
    const unauthenticated = await fetch(`${harness.url}/api/lists`);

    expect(unauthenticated.status).toBe(403);

    const body = await text('/metrics');
    const counted = body
      .split('\n')
      .filter((line) => line.startsWith('http_request_duration_seconds_count'));

    expect(counted.some((line) => /status_code="4\d\d"/.test(line))).toBe(true);
  });
});
