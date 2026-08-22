import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ListResponse } from '../lists/dto';
import { type TestHarness, call, startTestApp } from '../test-app.fixture';
import type { ItemPricePointResponse, ListTotalPointResponse, PricedItemResponse } from './dto';

let harness: TestHarness;

beforeAll(async () => {
  harness = await startTestApp();
});

afterAll(async () => {
  await harness.close();
});

async function closeOn(owner: string, listId: string, when: string): Promise<void> {
  await call(harness, owner, 'POST', `/api/lists/${listId}/close`);
  await harness.db.execute(
    sql`UPDATE list SET closed_at = ${when}::timestamptz WHERE id = ${listId}::uuid`,
  );
}

async function pricedList(
  owner: string,
  name: string,
  when: string,
  items: { text: string; unitPrice: string; quantity?: string }[],
): Promise<ListResponse> {
  const list = await call<ListResponse>(harness, owner, 'POST', '/api/lists', { name });

  for (const item of items) {
    await call(harness, owner, 'POST', `/api/lists/${list.body.id}/items`, item);
  }

  await closeOn(owner, list.body.id, when);

  return list.body;
}

describe('price history', () => {
  it('tracks one item across lists, in date order', async () => {
    const owner = harness.newOwner();

    await pricedList(owner, 'January run', '2026-01-10T12:00:00Z', [
      { text: 'leite', unitPrice: '4.20' },
      { text: 'café', unitPrice: '18.00' },
    ]);
    await pricedList(owner, 'February run', '2026-02-14T12:00:00Z', [
      { text: 'leite', unitPrice: '4.80' },
    ]);
    await pricedList(owner, 'March run', '2026-03-21T12:00:00Z', [
      { text: 'leite', unitPrice: '5.50' },
    ]);

    const series = await call<ItemPricePointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/item-prices?text=leite',
    );

    expect(series.status).toBe(200);
    expect(series.body.map((point) => point.unitPrice)).toEqual(['4.20', '4.80', '5.50']);
    expect(series.body.map((point) => point.listName)).toEqual([
      'January run',
      'February run',
      'March run',
    ]);
  });

  it('matches on the normalized text, so casing and stray spaces stay one series', async () => {
    const owner = harness.newOwner();

    await pricedList(owner, 'First', '2026-01-10T12:00:00Z', [
      { text: 'leite', unitPrice: '4.20' },
    ]);
    await pricedList(owner, 'Second', '2026-02-10T12:00:00Z', [
      { text: '  Leite ', unitPrice: '4.90' },
    ]);
    await pricedList(owner, 'Third', '2026-03-10T12:00:00Z', [
      { text: 'leite integral', unitPrice: '6.10' },
    ]);

    const series = await call<ItemPricePointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/item-prices?text=LEITE',
    );

    expect(series.body.map((point) => point.unitPrice)).toEqual(['4.20', '4.90']);
  });

  it('follows an item to its new series when its text is edited', async () => {
    const owner = harness.newOwner();
    const list = await call<ListResponse>(harness, owner, 'POST', '/api/lists', {
      name: 'Renaming',
    });
    const added = await call<ListResponse>(
      harness,
      owner,
      'POST',
      `/api/lists/${list.body.id}/items`,
      {
        text: 'leit',
        unitPrice: '4.20',
      },
    );

    await call(
      harness,
      owner,
      'PATCH',
      `/api/lists/${list.body.id}/items/${added.body.items[0]!.id}`,
      {
        text: 'leite',
      },
    );

    const wrong = await call<ItemPricePointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/item-prices?text=leit',
    );
    const right = await call<ItemPricePointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/item-prices?text=leite',
    );

    expect(wrong.body).toHaveLength(0);
    expect(right.body).toHaveLength(1);
  });

  it('lists everything ever priced, with its latest price and how often it was seen', async () => {
    const owner = harness.newOwner();

    await pricedList(owner, 'One', '2026-01-10T12:00:00Z', [
      { text: 'leite', unitPrice: '4.20' },
      { text: 'café', unitPrice: '18.00' },
    ]);
    await pricedList(owner, 'Two', '2026-02-10T12:00:00Z', [{ text: 'leite', unitPrice: '4.90' }]);

    const items = await call<PricedItemResponse[]>(harness, owner, 'GET', '/api/insights/items');
    const byText = new Map(items.body.map((item) => [item.text, item]));

    expect(byText.get('leite')?.observationCount).toBe(2);
    expect(byText.get('leite')?.latestPrice).toBe('4.90');
    expect(byText.get('café')?.observationCount).toBe(1);
  });

  it('counts an open list — a price typed in at the shelf is a real observation', async () => {
    const owner = harness.newOwner();
    const list = await call<ListResponse>(harness, owner, 'POST', '/api/lists', { name: 'Open' });

    await call(harness, owner, 'POST', `/api/lists/${list.body.id}/items`, {
      text: 'azeite',
      unitPrice: '32.00',
    });

    const series = await call<ItemPricePointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/item-prices?text=azeite',
    );

    expect(series.body).toHaveLength(1);
  });
});

describe('list totals', () => {
  it('reports one point per list, dated by when it was finished', async () => {
    const owner = harness.newOwner();

    await pricedList(owner, 'January run', '2026-01-10T12:00:00Z', [
      { text: 'leite', unitPrice: '4.20', quantity: '2' },
      { text: 'café', unitPrice: '18.00' },
    ]);
    await pricedList(owner, 'February run', '2026-02-14T12:00:00Z', [
      { text: 'leite', unitPrice: '4.80' },
    ]);

    const totals = await call<ListTotalPointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/list-totals',
    );

    expect(totals.body.map((point) => point.name)).toEqual(['January run', 'February run']);
    expect(totals.body[0]!.total).toBe('26.40');
    expect(totals.body[0]!.itemCount).toBe(2);
  });

  it('honours a date window', async () => {
    const owner = harness.newOwner();

    await pricedList(owner, 'Old', '2026-01-10T12:00:00Z', [{ text: 'x', unitPrice: '1.00' }]);
    await pricedList(owner, 'Recent', '2026-06-10T12:00:00Z', [{ text: 'y', unitPrice: '2.00' }]);

    const windowed = await call<ListTotalPointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/list-totals?from=2026-03-01T00:00:00Z',
    );

    expect(windowed.body.map((point) => point.name)).toEqual(['Recent']);
  });

  it('never shows one owner another owner’s prices', async () => {
    const mine = harness.newOwner();
    const theirs = harness.newOwner();

    await pricedList(mine, 'Mine', '2026-01-10T12:00:00Z', [{ text: 'leite', unitPrice: '4.20' }]);

    const series = await call<ItemPricePointResponse[]>(
      harness,
      theirs,
      'GET',
      '/api/insights/item-prices?text=leite',
    );
    const items = await call<PricedItemResponse[]>(harness, theirs, 'GET', '/api/insights/items');
    const totals = await call<ListTotalPointResponse[]>(
      harness,
      theirs,
      'GET',
      '/api/insights/list-totals',
    );

    expect(series.body).toHaveLength(0);
    expect(items.body).toHaveLength(0);
    expect(totals.body).toHaveLength(0);
  });
});

describe('windows and filters', () => {
  it('takes both ends of a window, inclusive', async () => {
    const owner = harness.newOwner();

    await pricedList(owner, 'Before', '2026-01-31T23:59:59Z', [{ text: 'x', unitPrice: '1.00' }]);
    await pricedList(owner, 'On the edge', '2026-02-01T00:00:00Z', [
      { text: 'x', unitPrice: '2.00' },
    ]);
    await pricedList(owner, 'Inside', '2026-02-15T12:00:00Z', [{ text: 'x', unitPrice: '3.00' }]);
    await pricedList(owner, 'After', '2026-03-01T00:00:01Z', [{ text: 'x', unitPrice: '4.00' }]);

    const windowed = await call<ListTotalPointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/list-totals?from=2026-02-01T00:00:00Z&to=2026-03-01T00:00:00Z',
    );

    expect(windowed.body.map((point) => point.name)).toEqual(['On the edge', 'Inside']);
  });

  it('leaves out a list nobody priced, and counts only the priced items of one', async () => {
    const owner = harness.newOwner();
    const unpriced = await call<ListResponse>(harness, owner, 'POST', '/api/lists', {
      name: 'Nothing priced',
    });

    await call(harness, owner, 'POST', `/api/lists/${unpriced.body.id}/items`, { text: 'leite' });
    await closeOn(owner, unpriced.body.id, '2026-01-05T12:00:00Z');

    const mixed = await pricedList(owner, 'Half priced', '2026-01-06T12:00:00Z', [
      { text: 'café', unitPrice: '18.00' },
    ]);

    await call(harness, owner, 'POST', `/api/lists/${mixed.id}/items`, { text: 'guardanapo' });

    const totals = await call<ListTotalPointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/list-totals',
    );

    expect(totals.body.map((point) => point.name)).toEqual(['Half priced']);
    expect(totals.body[0]!.itemCount).toBe(1);
    expect(totals.body[0]!.total).toBe('18.00');
  });

  it('refuses a window bound that is not a timestamp', async () => {
    const owner = harness.newOwner();

    const bad = await call<{ message: string }>(
      harness,
      owner,
      'GET',
      '/api/insights/list-totals?from=yesterday',
    );

    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('from');
  });

  it('asks for the item whose prices are wanted', async () => {
    const owner = harness.newOwner();

    const missing = await call<{ message: string }>(
      harness,
      owner,
      'GET',
      '/api/insights/item-prices',
    );
    const blank = await call(harness, owner, 'GET', '/api/insights/item-prices?text=%20%20');
    const unknown = await call<ItemPricePointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/item-prices?text=never%20bought',
    );

    expect(missing.status).toBe(400);
    expect(missing.body.message).toContain('text');
    expect(blank.status).toBe(400);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual([]);
  });
});

describe('the catalogue of priced items', () => {
  it('shows the most recent spelling and skips what was never priced', async () => {
    const owner = harness.newOwner();

    await pricedList(owner, 'One', '2026-01-10T12:00:00Z', [{ text: 'leite', unitPrice: '4.20' }]);
    await pricedList(owner, 'Two', '2026-02-10T12:00:00Z', [
      { text: 'Leite', unitPrice: '4.90' },
      { text: 'sal', unitPrice: '2.00' },
    ]);

    const unpriced = await call<ListResponse>(harness, owner, 'POST', '/api/lists', {
      name: 'Free',
    });

    await call(harness, owner, 'POST', `/api/lists/${unpriced.body.id}/items`, { text: 'água' });

    const items = await call<PricedItemResponse[]>(harness, owner, 'GET', '/api/insights/items');

    expect(items.body.map((item) => item.text)).toEqual(['Leite', 'sal']);
    expect(items.body[0]!.observationCount).toBe(2);
    expect(items.body[0]!.latestPrice).toBe('4.90');
    expect(items.body[0]!.latestAt).toMatch(/^2026-02-10T/);
  });

  it('prices a repeat purchase from the newest observation, whatever the list order', async () => {
    const owner = harness.newOwner();

    await pricedList(owner, 'Newest first', '2026-05-10T12:00:00Z', [
      { text: 'arroz', unitPrice: '25.00' },
    ]);
    await pricedList(owner, 'Older, added later', '2026-04-10T12:00:00Z', [
      { text: 'arroz', unitPrice: '19.00' },
    ]);

    const items = await call<PricedItemResponse[]>(harness, owner, 'GET', '/api/insights/items');
    const series = await call<ItemPricePointResponse[]>(
      harness,
      owner,
      'GET',
      '/api/insights/item-prices?text=arroz',
    );

    expect(items.body[0]!.latestPrice).toBe('25.00');
    expect(series.body.map((point) => point.unitPrice)).toEqual(['19.00', '25.00']);
  });
});
