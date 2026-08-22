import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PageResponse } from '../common/page-response';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { ListResponse, ListSummaryResponse } from './dto';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp();
});

afterAll(async () => {
  await harness.close();
});

async function newList(owner: string, name: string): Promise<ListResponse> {
  const created = await call<ListResponse>(harness, owner, 'POST', '/api/lists', { name });

  expect(created.status).toBe(201);

  return created.body;
}

async function addItem(
  owner: string,
  listId: string,
  item: { text: string; quantity?: string | number; unitPrice?: string | number },
): Promise<ListResponse> {
  const added = await call<ListResponse>(
    harness,
    owner,
    'POST',
    `/api/lists/${listId}/items`,
    item,
  );

  expect(added.status).toBe(201);

  return added.body;
}

describe('browsing lists', () => {
  it('answers newest first, with the totals already summed', async () => {
    const owner = harness.newOwner();
    const older = await newList(owner, 'Older');

    await addItem(owner, older.id, { text: 'leite', quantity: '2', unitPrice: '4.50' });
    await newList(owner, 'Newer');

    const page = await call<PageResponse<ListSummaryResponse>>(harness, owner, 'GET', '/api/lists');

    expect(page.status).toBe(200);
    expect(page.body.content.map((summary) => summary.name)).toEqual(['Newer', 'Older']);
    expect(page.body.size).toBe(25);
    expect(page.body.totalElements).toBe(2);

    const summary = page.body.content[1]!;

    expect(summary.itemCount).toBe(1);
    expect(summary.total).toBe('9.00');
    expect(summary.checkedTotal).toBeNull();
    expect(summary.pricedItemCount).toBe(1);
  });

  it('filters by status, and rejects a status that is not one', async () => {
    const owner = harness.newOwner();
    const closed = await newList(owner, 'Done');

    await newList(owner, 'Still going');
    await call(harness, owner, 'POST', `/api/lists/${closed.id}/close`);

    const open = await call<PageResponse<ListSummaryResponse>>(
      harness,
      owner,
      'GET',
      '/api/lists?status=open',
    );
    const done = await call<PageResponse<ListSummaryResponse>>(
      harness,
      owner,
      'GET',
      '/api/lists?status=closed',
    );
    const nonsense = await call(harness, owner, 'GET', '/api/lists?status=paused');

    expect(open.body.content.map((summary) => summary.name)).toEqual(['Still going']);
    expect(open.body.totalElements).toBe(1);
    expect(done.body.content.map((summary) => summary.name)).toEqual(['Done']);
    expect(nonsense.status).toBe(400);
  });

  it('counts every match, not just the page it returned', async () => {
    const owner = harness.newOwner();

    for (const name of ['one', 'two', 'three']) {
      await newList(owner, name);
    }

    const page = await call<PageResponse<ListSummaryResponse>>(
      harness,
      owner,
      'GET',
      '/api/lists?page=1&size=2',
    );

    expect(page.body.content).toHaveLength(1);
    expect(page.body.page).toBe(1);
    expect(page.body.totalElements).toBe(3);
    expect(page.body.totalPages).toBe(2);
  });
});

describe('editing a list', () => {
  it('renames without touching anything else', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Typo');

    await addItem(owner, list.id, { text: 'leite', unitPrice: '4.50' });

    const renamed = await call<ListResponse>(harness, owner, 'PATCH', `/api/lists/${list.id}`, {
      name: 'Groceries',
    });

    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Groceries');
    expect(renamed.body.createdAt).toBe(list.createdAt);
    expect(renamed.body.items).toHaveLength(1);
  });

  it('deletes the list and its items with it', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Doomed');
    const withItem = await addItem(owner, list.id, { text: 'leite' });
    const itemId = withItem.items[0]!.id;

    const deleted = await call(harness, owner, 'DELETE', `/api/lists/${list.id}`);

    expect(deleted.status).toBe(204);
    expect((await call(harness, owner, 'GET', `/api/lists/${list.id}`)).status).toBe(404);

    const orphans = await harness.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM list_item WHERE id = ${itemId}::uuid`,
    );

    expect(orphans[0]?.count).toBe(0);
  });

  it('is idempotent about closing and reopening', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Twice');

    const once = await call<ListResponse>(harness, owner, 'POST', `/api/lists/${list.id}/close`);
    const twice = await call<ListResponse>(harness, owner, 'POST', `/api/lists/${list.id}/close`);

    expect(twice.status).toBe(201);
    expect(twice.body.status).toBe('closed');
    expect(Date.parse(twice.body.closedAt!)).toBeGreaterThanOrEqual(
      Date.parse(once.body.closedAt!),
    );

    const reopened = await call<ListResponse>(
      harness,
      owner,
      'POST',
      `/api/lists/${list.id}/reopen`,
    );
    const again = await call<ListResponse>(harness, owner, 'POST', `/api/lists/${list.id}/reopen`);

    expect(reopened.body.closedAt).toBeNull();
    expect(again.body.status).toBe('open');
  });

  it('answers 404 for an unknown list and 400 for an id that is not a uuid', async () => {
    const owner = harness.newOwner();
    const missing = harness.newOwner();

    expect((await call(harness, owner, 'GET', `/api/lists/${missing}`)).status).toBe(404);
    expect(
      (await call(harness, owner, 'PATCH', `/api/lists/${missing}`, { name: 'x' })).status,
    ).toBe(404);
    expect((await call(harness, owner, 'POST', `/api/lists/${missing}/close`)).status).toBe(404);
    expect((await call(harness, owner, 'DELETE', `/api/lists/${missing}`)).status).toBe(404);
    expect((await call(harness, owner, 'GET', '/api/lists/nope')).status).toBe(400);
  });
});

describe('items', () => {
  it('appends to the end, and keeps the order after a deletion', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Ordering');

    await addItem(owner, list.id, { text: 'first' });
    const two = await addItem(owner, list.id, { text: 'second' });

    await call(harness, owner, 'DELETE', `/api/lists/${list.id}/items/${two.items[0]!.id}`);

    const three = await addItem(owner, list.id, { text: 'third' });

    expect(three.items.map((item) => item.text)).toEqual(['second', 'third']);
    expect(three.items[1]!.sortOrder).toBeGreaterThan(three.items[0]!.sortOrder);
  });

  it('stores decimals at the scale the column keeps, from a number or a string', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Scales');
    const added = await addItem(owner, list.id, { text: 'leite', quantity: 2, unitPrice: 4.5 });
    const item = added.items[0]!;

    expect(item.quantity).toBe('2.00');
    expect(item.unitPrice).toBe('4.50');
    expect(item.subtotal).toBe('9.00');
  });

  it('refuses a negative amount and text beyond the column width', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Limits');

    const negative = await call(harness, owner, 'POST', `/api/lists/${list.id}/items`, {
      text: 'leite',
      unitPrice: '-1.00',
    });
    const tooLong = await call(harness, owner, 'POST', `/api/lists/${list.id}/items`, {
      text: 'x'.repeat(501),
    });

    expect(negative.status).toBe(400);
    expect(tooLong.status).toBe(400);
  });

  it('unchecks what was checked, and forgets the checked total with it', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Trolley');
    const added = await addItem(owner, list.id, { text: 'leite', unitPrice: '4.50' });
    const itemId = added.items[0]!.id;

    const checked = await call<ListResponse>(
      harness,
      owner,
      'PATCH',
      `/api/lists/${list.id}/items/${itemId}`,
      { checked: true },
    );

    expect(checked.body.checkedTotal).toBe('4.50');
    expect(checked.body.checkedCount).toBe(1);

    const unchecked = await call<ListResponse>(
      harness,
      owner,
      'PATCH',
      `/api/lists/${list.id}/items/${itemId}`,
      { checked: false },
    );

    expect(unchecked.body.checkedTotal).toBeNull();
    expect(unchecked.body.checkedCount).toBe(0);
  });

  it('will not touch an item that belongs to another list', async () => {
    const owner = harness.newOwner();
    const mine = await newList(owner, 'Mine');
    const other = await newList(owner, 'Other');
    const added = await addItem(owner, other.id, { text: 'elsewhere' });
    const itemId = added.items[0]!.id;

    expect(
      (
        await call(harness, owner, 'PATCH', `/api/lists/${mine.id}/items/${itemId}`, {
          checked: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(harness, owner, 'DELETE', `/api/lists/${mine.id}/items/${itemId}`)).status,
    ).toBe(404);
  });

  it('refuses an ordering that repeats an item or names a stranger', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Reorder');

    await addItem(owner, list.id, { text: 'first' });
    const two = await addItem(owner, list.id, { text: 'second' });
    const ids = two.items.map((item) => item.id);

    const duplicated = await call(harness, owner, 'PUT', `/api/lists/${list.id}/items/order`, {
      itemIds: [ids[0], ids[0]],
    });
    const stranger = await call(harness, owner, 'PUT', `/api/lists/${list.id}/items/order`, {
      itemIds: [ids[0], harness.newOwner()],
    });
    const empty = await call(harness, owner, 'PUT', `/api/lists/${list.id}/items/order`, {
      itemIds: [],
    });

    expect(duplicated.status).toBe(404);
    expect(stranger.status).toBe(404);
    expect(empty.status).toBe(400);
  });
});

describe('saving a list as a template', () => {
  it('carries an empty list over as an empty template', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Nothing yet');

    const saved = await call<{ templateId: string }>(
      harness,
      owner,
      'POST',
      `/api/lists/${list.id}/save-as-template`,
      { name: 'Blank' },
    );

    expect(saved.status).toBe(201);

    const template = await call<{ itemCount: number }>(
      harness,
      owner,
      'GET',
      `/api/templates/${saved.body.templateId}`,
    );

    expect(template.body.itemCount).toBe(0);
  });

  it('refuses to overwrite a template that is not there', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Source');

    const saved = await call(harness, owner, 'POST', `/api/lists/${list.id}/save-as-template`, {
      name: 'Nowhere',
      templateId: harness.newOwner(),
    });

    expect(saved.status).toBe(404);
  });
});
