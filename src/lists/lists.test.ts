import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { ListResponse, ListSummaryResponse } from './dto';
import type { TemplateResponse } from '../templates/dto';
import type { PageResponse } from '../common/page-response';

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
  item: { text: string; quantity?: string; unitPrice?: string },
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

describe('the core loop', () => {
  it('creates a list, adds items, checks them off and closes it', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Packing for Lisbon');

    expect(list.status).toBe('open');
    expect(list.items).toHaveLength(0);

    await addItem(owner, list.id, { text: 'passport' });
    const withItems = await addItem(owner, list.id, { text: 'charger', quantity: '2' });

    expect(withItems.items.map((item) => item.text)).toEqual(['passport', 'charger']);
    expect(withItems.itemCount).toBe(2);
    expect(withItems.total).toBeNull();
    expect(withItems.pricedItemCount).toBe(0);

    const passport = withItems.items[0]!;
    const checked = await call<ListResponse>(
      harness,
      owner,
      'PATCH',
      `/api/lists/${list.id}/items/${passport.id}`,
      { checked: true },
    );

    expect(checked.status).toBe(200);
    expect(checked.body.checkedCount).toBe(1);

    const closed = await call<ListResponse>(harness, owner, 'POST', `/api/lists/${list.id}/close`);

    expect(closed.body.status).toBe('closed');
    expect(closed.body.closedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(closed.body.closedAt!))).toBe(false);
    expect(closed.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    const reopened = await call<ListResponse>(
      harness,
      owner,
      'POST',
      `/api/lists/${list.id}/reopen`,
    );

    expect(reopened.body.status).toBe('open');
    expect(reopened.body.closedAt).toBeNull();
  });

  it('totals only what is priced, and separately what is already in the trolley', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Grocery run');

    await addItem(owner, list.id, { text: 'leite', quantity: '2', unitPrice: '4.50' });
    await addItem(owner, list.id, { text: 'pão', unitPrice: '7.25' });
    const full = await addItem(owner, list.id, { text: 'guardanapo' });

    expect(full.total).toBe('16.25');
    expect(full.checkedTotal).toBeNull();
    expect(full.pricedItemCount).toBe(2);
    expect(full.items[1]!.subtotal).toBe('7.25');
    expect(full.items[2]!.subtotal).toBeNull();

    const milk = full.items[0]!;
    const checked = await call<ListResponse>(
      harness,
      owner,
      'PATCH',
      `/api/lists/${list.id}/items/${milk.id}`,
      { checked: true },
    );

    expect(checked.body.checkedTotal).toBe('9.00');
    expect(checked.body.total).toBe('16.25');
  });

  it('distinguishes clearing a price from leaving it alone', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Clothes');
    const withItem = await addItem(owner, list.id, { text: 'jacket', unitPrice: '120.00' });
    const jacket = withItem.items[0]!;

    const renamed = await call<ListResponse>(
      harness,
      owner,
      'PATCH',
      `/api/lists/${list.id}/items/${jacket.id}`,
      { text: 'winter jacket' },
    );

    expect(renamed.body.items[0]!.unitPrice).toBe('120.00');

    const cleared = await call<ListResponse>(
      harness,
      owner,
      'PATCH',
      `/api/lists/${list.id}/items/${jacket.id}`,
      { unitPrice: null },
    );

    expect(cleared.body.items[0]!.unitPrice).toBeNull();
    expect(cleared.body.total).toBeNull();
  });

  it('reorders in one call and refuses a partial ordering', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Reorder me');

    await addItem(owner, list.id, { text: 'first' });
    await addItem(owner, list.id, { text: 'second' });
    const three = await addItem(owner, list.id, { text: 'third' });
    const ids = three.items.map((item) => item.id);

    const reordered = await call<ListResponse>(
      harness,
      owner,
      'PUT',
      `/api/lists/${list.id}/items/order`,
      { itemIds: [ids[2], ids[0], ids[1]] },
    );

    expect(reordered.body.items.map((item) => item.text)).toEqual(['third', 'first', 'second']);

    const partial = await call(harness, owner, 'PUT', `/api/lists/${list.id}/items/order`, {
      itemIds: [ids[0]],
    });

    expect(partial.status).toBe(404);
  });
});

describe('templates', () => {
  it('copies every item into a new list and is left untouched by editing it', async () => {
    const owner = harness.newOwner();
    const created = await call<TemplateResponse>(harness, owner, 'POST', '/api/templates', {
      name: 'Weekly groceries',
      items: [
        { text: 'leite', defaultQuantity: '2' },
        { text: 'pão' },
        { text: 'café', defaultQuantity: '1' },
        { text: 'arroz' },
        { text: 'feijão' },
      ],
    });

    expect(created.status).toBe(201);

    const template = created.body;
    const before = JSON.stringify(template);

    const list = await call<ListResponse>(harness, owner, 'POST', '/api/lists', {
      name: 'Saturday run',
      templateId: template.id,
    });

    expect(list.status).toBe(201);
    expect(list.body.templateId).toBe(template.id);
    expect(list.body.items).toHaveLength(5);
    expect(list.body.items.map((item) => item.text)).toEqual([
      'leite',
      'pão',
      'café',
      'arroz',
      'feijão',
    ]);
    expect(list.body.items.every((item) => !item.checked)).toBe(true);
    expect(list.body.items[0]!.quantity).toBe('2.00');

    await addItem(owner, list.body.id, { text: 'chocolate' });
    await call(
      harness,
      owner,
      'DELETE',
      `/api/lists/${list.body.id}/items/${list.body.items[0]!.id}`,
    );

    const after = await call<TemplateResponse>(
      harness,
      owner,
      'GET',
      `/api/templates/${template.id}`,
    );

    expect(JSON.stringify(after.body)).toBe(before);
  });

  it('prefills prices from the last time each item was priced', async () => {
    const owner = harness.newOwner();
    const template = await call<TemplateResponse>(harness, owner, 'POST', '/api/templates', {
      name: 'Staples',
      items: [{ text: 'leite' }, { text: 'pão' }, { text: 'never bought' }],
    });

    const march = await call<ListResponse>(harness, owner, 'POST', '/api/lists', {
      name: 'March run',
      templateId: template.body.id,
    });

    expect(march.body.items.every((item) => item.unitPrice === null)).toBe(true);

    await call(
      harness,
      owner,
      'PATCH',
      `/api/lists/${march.body.id}/items/${march.body.items[0]!.id}`,
      {
        unitPrice: '4.50',
      },
    );
    await call(
      harness,
      owner,
      'PATCH',
      `/api/lists/${march.body.id}/items/${march.body.items[1]!.id}`,
      {
        unitPrice: '7.00',
      },
    );
    await call(harness, owner, 'POST', `/api/lists/${march.body.id}/close`);

    const april = await call<ListResponse>(harness, owner, 'POST', '/api/lists', {
      name: 'April run',
      templateId: template.body.id,
    });

    expect(april.body.items.map((item) => item.unitPrice)).toEqual(['4.50', '7.00', null]);
    expect(april.body.total).toBe('11.50');
  });

  it('saves a list back as a template, discarding what was checked off', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Camping');

    await addItem(owner, list.id, { text: 'tent', quantity: '1' });
    const withItems = await addItem(owner, list.id, { text: 'stove', unitPrice: '89.90' });

    await call(harness, owner, 'PATCH', `/api/lists/${list.id}/items/${withItems.items[0]!.id}`, {
      checked: true,
    });

    const saved = await call<{ templateId: string }>(
      harness,
      owner,
      'POST',
      `/api/lists/${list.id}/save-as-template`,
      { name: 'Camping kit' },
    );

    expect(saved.status).toBe(201);

    const template = await call<TemplateResponse>(
      harness,
      owner,
      'GET',
      `/api/templates/${saved.body.templateId}`,
    );

    expect(template.body.name).toBe('Camping kit');
    expect(template.body.items.map((item) => item.text)).toEqual(['tent', 'stove']);
    expect(template.body.items[0]!.defaultQuantity).toBe('1.00');
    const reread = await call<ListResponse>(harness, owner, 'GET', `/api/lists/${list.id}`);

    expect(reread.body.templateId).toBeNull();
  });

  it('replaces an existing template when one is named', async () => {
    const owner = harness.newOwner();
    const template = await call<TemplateResponse>(harness, owner, 'POST', '/api/templates', {
      name: 'Old kit',
      items: [{ text: 'obsolete' }],
    });
    const list = await newList(owner, 'This year');

    await addItem(owner, list.id, { text: 'new thing' });

    await call(harness, owner, 'POST', `/api/lists/${list.id}/save-as-template`, {
      name: 'Current kit',
      templateId: template.body.id,
    });

    const updated = await call<TemplateResponse>(
      harness,
      owner,
      'GET',
      `/api/templates/${template.body.id}`,
    );

    expect(updated.body.name).toBe('Current kit');
    expect(updated.body.items.map((item) => item.text)).toEqual(['new thing']);
  });

  it('keeps lists alive when the template they came from is deleted', async () => {
    const owner = harness.newOwner();
    const template = await call<TemplateResponse>(harness, owner, 'POST', '/api/templates', {
      name: 'Disposable',
      items: [{ text: 'thing' }],
    });
    const list = await call<ListResponse>(harness, owner, 'POST', '/api/lists', {
      name: 'From disposable',
      templateId: template.body.id,
    });

    const deleted = await call(harness, owner, 'DELETE', `/api/templates/${template.body.id}`);

    expect(deleted.status).toBe(204);

    const survivor = await call<ListResponse>(harness, owner, 'GET', `/api/lists/${list.body.id}`);

    expect(survivor.status).toBe(200);
    expect(survivor.body.templateId).toBeNull();
    expect(survivor.body.items).toHaveLength(1);
  });
});

describe('ownership', () => {
  it('answers 404 rather than 403 for another owner’s rows', async () => {
    const mine = harness.newOwner();
    const theirs = harness.newOwner();
    const list = await newList(mine, 'Private');
    const template = await call<TemplateResponse>(harness, theirs, 'POST', '/api/templates', {
      name: 'Theirs',
      items: [{ text: 'secret' }],
    });

    expect((await call(harness, theirs, 'GET', `/api/lists/${list.id}`)).status).toBe(404);
    expect((await call(harness, theirs, 'DELETE', `/api/lists/${list.id}`)).status).toBe(404);
    expect(
      (await call(harness, theirs, 'POST', `/api/lists/${list.id}/items`, { text: 'x' })).status,
    ).toBe(404);

    const stolen = await call(harness, mine, 'POST', '/api/lists', {
      name: 'Nice template',
      templateId: template.body.id,
    });

    expect(stolen.status).toBe(404);

    const listing = await call<PageResponse<ListSummaryResponse>>(
      harness,
      theirs,
      'GET',
      '/api/lists',
    );

    expect(listing.body.content.some((summary) => summary.id === list.id)).toBe(false);
  });
});

describe('validation', () => {
  it('rejects a nonsense price with a field-named message', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Validation');

    const bad = await call<{ message: string }>(
      harness,
      owner,
      'POST',
      `/api/lists/${list.id}/items`,
      { text: 'thing', unitPrice: '4.5678' },
    );

    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('unitPrice');
  });

  it('rejects an empty PATCH rather than answering 200 to a client bug', async () => {
    const owner = harness.newOwner();
    const list = await newList(owner, 'Empty patch');
    const withItem = await addItem(owner, list.id, { text: 'thing' });

    const empty = await call(
      harness,
      owner,
      'PATCH',
      `/api/lists/${list.id}/items/${withItem.items[0]!.id}`,
      {},
    );

    expect(empty.status).toBe(400);
  });
});
