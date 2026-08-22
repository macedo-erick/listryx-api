import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import type { ItemPricePointResponse, ListTotalPointResponse, PricedItemResponse } from './dto';

const OBSERVED_AT = sql`COALESCE(l.closed_at, l.created_at)`;
const OBSERVED_AT_ISO = sql`(to_jsonb(COALESCE(l.closed_at, l.created_at)) #>> '{}')`;

@Injectable()
export class InsightRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async lastKnownPrices(
    ownerId: string,
    normalizedTexts: readonly string[],
  ): Promise<Map<string, string>> {
    if (normalizedTexts.length === 0) {
      return new Map();
    }

    const values = sql.join(
      normalizedTexts.map((text) => sql`${text}`),
      sql`, `,
    );

    const rows = await this.db.execute<{ normalizedText: string; unitPrice: string }>(sql`
      SELECT DISTINCT ON (i.normalized_text)
        i.normalized_text AS "normalizedText",
        i.unit_price AS "unitPrice"
      FROM list_item i
      JOIN list l ON l.id = i.list_id
      WHERE l.owner_id = ${ownerId}
        AND i.unit_price IS NOT NULL
        AND i.normalized_text IN (${values})
      ORDER BY i.normalized_text, ${OBSERVED_AT} DESC, i.id DESC
    `);

    return new Map(rows.map((row) => [row.normalizedText, row.unitPrice]));
  }

  async pricedItems(ownerId: string): Promise<PricedItemResponse[]> {
    const rows = await this.db.execute<PricedItemResponse>(sql`
      WITH observations AS (
        SELECT
          i.normalized_text,
          i.text,
          i.unit_price,
          ${OBSERVED_AT} AS observed_at,
          i.id
        FROM list_item i
        JOIN list l ON l.id = i.list_id
        WHERE l.owner_id = ${ownerId} AND i.unit_price IS NOT NULL
      ),
      latest AS (
        SELECT DISTINCT ON (normalized_text) normalized_text, text, unit_price, observed_at
        FROM observations
        ORDER BY normalized_text, observed_at DESC, id DESC
      )
      SELECT
        latest.text,
        COUNT(observations.id)::int AS "observationCount",
        latest.unit_price AS "latestPrice",
        (to_jsonb(latest.observed_at) #>> '{}') AS "latestAt"
      FROM latest
      JOIN observations ON observations.normalized_text = latest.normalized_text
      GROUP BY latest.normalized_text, latest.text, latest.unit_price, latest.observed_at
      ORDER BY latest.text
    `);

    return [...rows];
  }

  async itemPrices(ownerId: string, text: string): Promise<ItemPricePointResponse[]> {
    const normalized = text.trim().toLowerCase();

    const rows = await this.db.execute<ItemPricePointResponse>(sql`
      SELECT
        ${OBSERVED_AT_ISO} AS "at",
        i.unit_price AS "unitPrice",
        l.id AS "listId",
        l.name AS "listName"
      FROM list_item i
      JOIN list l ON l.id = i.list_id
      WHERE l.owner_id = ${ownerId}
        AND i.unit_price IS NOT NULL
        AND i.normalized_text = ${normalized}
      ORDER BY ${OBSERVED_AT} ASC, i.id ASC
    `);

    return [...rows];
  }

  async listTotals(
    ownerId: string,
    from: string | undefined,
    to: string | undefined,
  ): Promise<ListTotalPointResponse[]> {
    const fromFilter = from === undefined ? sql`` : sql`AND ${OBSERVED_AT} >= ${from}::timestamptz`;
    const toFilter = to === undefined ? sql`` : sql`AND ${OBSERVED_AT} <= ${to}::timestamptz`;

    const rows = await this.db.execute<ListTotalPointResponse>(sql`
      SELECT
        l.id AS "listId",
        l.name,
        ${OBSERVED_AT_ISO} AS "at",
        (SUM(COALESCE(i.quantity, 1) * i.unit_price))::numeric(12, 2) AS "total",
        COUNT(i.unit_price)::int AS "itemCount"
      FROM list l
      JOIN list_item i ON i.list_id = l.id
      WHERE l.owner_id = ${ownerId}
        AND i.unit_price IS NOT NULL
        ${fromFilter}
        ${toFilter}
      GROUP BY l.id, l.name, l.closed_at, l.created_at
      ORDER BY ${OBSERVED_AT} ASC
    `);

    return [...rows];
  }
}
