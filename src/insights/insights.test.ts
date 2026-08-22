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
