import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PageResponse } from '../common/page-response';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { TemplateResponse, TemplateSummaryResponse } from './dto';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp();
});

afterAll(async () => {
  await harness.close();
});

async function newTemplate(
  owner: string,
  name: string,
  items: { text: string; defaultQuantity?: string }[] = [],
): Promise<TemplateResponse> {
  const created = await call<TemplateResponse>(harness, owner, 'POST', '/api/templates', {
    name,
    items,
  });

  expect(created.status).toBe(201);

  return created.body;
}

describe('writing a template', () => {
  it('keeps the items in the order they were given', async () => {
    const owner = harness.newOwner();
    const template = await newTemplate(owner, 'Weekly', [
      { text: 'leite', defaultQuantity: '2' },
      { text: 'pão' },
      { text: 'café', defaultQuantity: '0.5' },
    ]);

    expect(template.items.map((item) => item.text)).toEqual(['leite', 'pão', 'café']);
    expect(template.items.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
    expect(template.items.map((item) => item.defaultQuantity)).toEqual(['2.00', null, '0.50']);
    expect(template.itemCount).toBe(3);
    expect(template.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('accepts a template with no items at all', async () => {
    const owner = harness.newOwner();
    const created = await call<TemplateResponse>(harness, owner, 'POST', '/api/templates', {
      name: 'Empty for now',
    });

    expect(created.status).toBe(201);
    expect(created.body.items).toEqual([]);
    expect(created.body.itemCount).toBe(0);
  });

  it('trims the name and the item texts', async () => {
    const owner = harness.newOwner();
    const template = await newTemplate(owner, '  Padded  ', [{ text: '  leite  ' }]);

    expect(template.name).toBe('Padded');
    expect(template.items[0]!.text).toBe('leite');
  });

  it('replaces every item wholesale, keeping the template id', async () => {
    const owner = harness.newOwner();
    const template = await newTemplate(owner, 'Before', [{ text: 'old' }, { text: 'older' }]);

    const replaced = await call<TemplateResponse>(
      harness,
      owner,
      'PUT',
      `/api/templates/${template.id}`,
      { name: 'After', items: [{ text: 'new' }] },
    );

    expect(replaced.status).toBe(200);
    expect(replaced.body.id).toBe(template.id);
    expect(replaced.body.name).toBe('After');
    expect(replaced.body.items.map((item) => item.text)).toEqual(['new']);
    expect(replaced.body.items[0]!.id).not.toBe(template.items[0]!.id);
  });

  it('empties a template when the replacement names no items', async () => {
    const owner = harness.newOwner();
    const template = await newTemplate(owner, 'Shrinking', [{ text: 'gone' }]);

    const replaced = await call<TemplateResponse>(
      harness,
      owner,
      'PUT',
      `/api/templates/${template.id}`,
      { name: 'Shrinking', items: [] },
    );

    expect(replaced.body.items).toEqual([]);
    expect(replaced.body.itemCount).toBe(0);
  });

  it('deletes a template and forgets it', async () => {
    const owner = harness.newOwner();
    const template = await newTemplate(owner, 'Disposable', [{ text: 'thing' }]);

    const deleted = await call(harness, owner, 'DELETE', `/api/templates/${template.id}`);

    expect(deleted.status).toBe(204);
    expect((await call(harness, owner, 'GET', `/api/templates/${template.id}`)).status).toBe(404);
    expect((await call(harness, owner, 'DELETE', `/api/templates/${template.id}`)).status).toBe(
      404,
    );
  });
});

describe('listing templates', () => {
  it('orders by name and reports the page it answered', async () => {
    const owner = harness.newOwner();

    await newTemplate(owner, 'Camping');
    await newTemplate(owner, 'Barbecue', [{ text: 'carvão' }]);
    await newTemplate(owner, 'Away game');

    const page = await call<PageResponse<TemplateSummaryResponse>>(
      harness,
      owner,
      'GET',
      '/api/templates',
    );

    expect(page.status).toBe(200);
    expect(page.body.content.map((summary) => summary.name)).toEqual([
      'Away game',
      'Barbecue',
      'Camping',
    ]);
    expect(page.body.page).toBe(0);
    expect(page.body.size).toBe(50);
    expect(page.body.totalElements).toBe(3);
    expect(page.body.totalPages).toBe(1);
    expect(page.body.content[1]!.itemCount).toBe(1);
  });

  it('walks through the pages a size at a time', async () => {
    const owner = harness.newOwner();

    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      await newTemplate(owner, name);
    }

    const first = await call<PageResponse<TemplateSummaryResponse>>(
      harness,
      owner,
      'GET',
      '/api/templates?page=0&size=2',
    );
    const last = await call<PageResponse<TemplateSummaryResponse>>(
      harness,
      owner,
      'GET',
      '/api/templates?page=2&size=2',
    );
    const past = await call<PageResponse<TemplateSummaryResponse>>(
      harness,
      owner,
      'GET',
      '/api/templates?page=9&size=2',
    );

    expect(first.body.content.map((summary) => summary.name)).toEqual(['A', 'B']);
    expect(first.body.totalPages).toBe(3);
    expect(last.body.content.map((summary) => summary.name)).toEqual(['E']);
    expect(past.body.content).toEqual([]);
    expect(past.body.totalElements).toBe(5);
  });

  it('rejects a page size beyond the cap', async () => {
    const owner = harness.newOwner();

    const tooBig = await call<{ message: string }>(
      harness,
      owner,
      'GET',
      '/api/templates?size=101',
    );
    const negative = await call(harness, owner, 'GET', '/api/templates?page=-1');

    expect(tooBig.status).toBe(400);
    expect(tooBig.body.message).toContain('size');
    expect(negative.status).toBe(400);
  });
});

describe('ownership', () => {
  it('hides another owner’s template behind a 404', async () => {
    const mine = harness.newOwner();
    const theirs = harness.newOwner();
    const template = await newTemplate(mine, 'Private', [{ text: 'secret' }]);

    expect((await call(harness, theirs, 'GET', `/api/templates/${template.id}`)).status).toBe(404);
    expect(
      (
        await call(harness, theirs, 'PUT', `/api/templates/${template.id}`, {
          name: 'Stolen',
          items: [],
        })
      ).status,
    ).toBe(404);
    expect((await call(harness, theirs, 'DELETE', `/api/templates/${template.id}`)).status).toBe(
      404,
    );

    const listing = await call<PageResponse<TemplateSummaryResponse>>(
      harness,
      theirs,
      'GET',
      '/api/templates',
    );

    expect(listing.body.content).toEqual([]);

    const untouched = await call<TemplateResponse>(
      harness,
      mine,
      'GET',
      `/api/templates/${template.id}`,
    );

    expect(untouched.body.name).toBe('Private');
  });
});

describe('validation', () => {
  it('names the offending item field in the message', async () => {
    const owner = harness.newOwner();

    const bad = await call<{ message: string }>(harness, owner, 'POST', '/api/templates', {
      name: 'Nonsense',
      items: [{ text: 'leite' }, { text: 'pão', defaultQuantity: '1.234' }],
    });

    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('items.1.defaultQuantity');
  });

  it('refuses a blank name and a blank item', async () => {
    const owner = harness.newOwner();

    const blankName = await call(harness, owner, 'POST', '/api/templates', {
      name: '   ',
      items: [],
    });
    const blankItem = await call(harness, owner, 'POST', '/api/templates', {
      name: 'Fine',
      items: [{ text: '  ' }],
    });

    expect(blankName.status).toBe(400);
    expect(blankItem.status).toBe(400);
  });

  it('refuses more items than a template may hold', async () => {
    const owner = harness.newOwner();
    const items = Array.from({ length: 501 }, (_, index) => ({ text: `item ${String(index)}` }));

    const tooMany = await call(harness, owner, 'POST', '/api/templates', {
      name: 'Hoarder',
      items,
    });

    expect(tooMany.status).toBe(400);
  });

  it('answers 400, not 404, for an id that is not a uuid', async () => {
    const owner = harness.newOwner();

    expect((await call(harness, owner, 'GET', '/api/templates/not-a-uuid')).status).toBe(400);
  });
});
