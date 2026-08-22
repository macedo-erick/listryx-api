import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { list, listItem } from '../database/schema';
import type { ListItemResponse, ListQuery, ListSummaryResponse } from './dto';

@Injectable()
export class ListRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private readonly summarySelect = sql`
      l.id,
      l.name,
      l.status,
      l.template_id AS "templateId",
      (to_jsonb(l.created_at) #>> '{}') AS "createdAt",
      (to_jsonb(l.closed_at) #>> '{}') AS "closedAt",
      COUNT(i.id)::int AS "itemCount",
      COUNT(i.id) FILTER (WHERE i.checked)::int AS "checkedCount",
      COUNT(i.unit_price)::int AS "pricedItemCount",
      (SUM(COALESCE(i.quantity, 1) * i.unit_price))::numeric(12, 2) AS "total",
      (SUM(COALESCE(i.quantity, 1) * i.unit_price) FILTER (WHERE i.checked))::numeric(12, 2)
        AS "checkedTotal"
  `;

  async findSummaries(
    ownerId: string,
    query: ListQuery,
  ): Promise<{ content: ListSummaryResponse[]; totalElements: number }> {
    const status = query.status;
    const statusFilter = status === undefined ? sql`` : sql`AND l.status = ${status}`;

    const rows = await this.db.execute<ListSummaryResponse>(sql`
      SELECT ${this.summarySelect}
      FROM list l
      LEFT JOIN list_item i ON i.list_id = l.id
      WHERE l.owner_id = ${ownerId} ${statusFilter}
      GROUP BY l.id
      ORDER BY l.created_at DESC
      LIMIT ${query.size} OFFSET ${query.page * query.size}
    `);

    const counted = await this.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM list l
      WHERE l.owner_id = ${ownerId} ${statusFilter}
    `);

    return {
      content: [...rows],
      totalElements: counted[0]?.count ?? 0,
    };
  }

  async findSummary(ownerId: string, listId: string): Promise<ListSummaryResponse | undefined> {
    const rows = await this.db.execute<ListSummaryResponse>(sql`
      SELECT ${this.summarySelect}
      FROM list l
      LEFT JOIN list_item i ON i.list_id = l.id
      WHERE l.owner_id = ${ownerId} AND l.id = ${listId}
      GROUP BY l.id
    `);

    return rows[0];
  }

  async findItems(listId: string): Promise<ListItemResponse[]> {
    const rows = await this.db.execute<ListItemResponse>(sql`
      SELECT
        id,
        text,
        quantity,
        unit_price AS "unitPrice",
        (COALESCE(quantity, 1) * unit_price)::numeric(12, 2) AS "subtotal",
        checked,
        sort_order AS "sortOrder"
      FROM list_item
      WHERE list_id = ${listId}
      ORDER BY sort_order, id
    `);

    return [...rows];
  }

  async exists(ownerId: string, listId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: list.id })
      .from(list)
      .where(and(eq(list.ownerId, ownerId), eq(list.id, listId)))
      .limit(1);

    return rows.length > 0;
  }

  async rename(ownerId: string, listId: string, name: string): Promise<boolean> {
    const updated = await this.db
      .update(list)
      .set({ name })
      .where(and(eq(list.ownerId, ownerId), eq(list.id, listId)))
      .returning({ id: list.id });

    return updated.length > 0;
  }

  async setStatus(ownerId: string, listId: string, status: 'open' | 'closed'): Promise<boolean> {
    const updated = await this.db
      .update(list)
      .set({ status, closedAt: status === 'closed' ? new Date() : null })
      .where(and(eq(list.ownerId, ownerId), eq(list.id, listId)))
      .returning({ id: list.id });

    return updated.length > 0;
  }

  async delete(ownerId: string, listId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(list)
      .where(and(eq(list.ownerId, ownerId), eq(list.id, listId)))
      .returning({ id: list.id });

    return deleted.length > 0;
  }

  async nextSortOrder(listId: string): Promise<number> {
    const rows = await this.db.execute<{ next: number }>(sql`
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM list_item WHERE list_id = ${listId}
    `);

    return rows[0]?.next ?? 0;
  }

  async insertItem(values: {
    id: string;
    listId: string;
    text: string;
    quantity: string | null;
    unitPrice: string | null;
    sortOrder: number;
  }): Promise<void> {
    await this.db.insert(listItem).values(values);
  }

  async updateItem(
    listId: string,
    itemId: string,
    values: Partial<{
      text: string;
      quantity: string | null;
      unitPrice: string | null;
      checked: boolean;
    }>,
  ): Promise<boolean> {
    const updated = await this.db
      .update(listItem)
      .set(values)
      .where(and(eq(listItem.listId, listId), eq(listItem.id, itemId)))
      .returning({ id: listItem.id });

    return updated.length > 0;
  }

  async deleteItem(listId: string, itemId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(listItem)
      .where(and(eq(listItem.listId, listId), eq(listItem.id, itemId)))
      .returning({ id: listItem.id });

    return deleted.length > 0;
  }

  async findItem(listId: string, itemId: string): Promise<ListItemResponse | undefined> {
    const items = await this.findItems(listId);

    return items.find((item) => item.id === itemId);
  }

  async reorderItems(listId: string, itemIds: readonly string[]): Promise<void> {
    const pairs = itemIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`);

    await this.db.execute(sql`
      UPDATE list_item AS i
      SET sort_order = o.sort_order
      FROM (VALUES ${sql.join(pairs, sql`, `)}) AS o(id, sort_order)
      WHERE i.id = o.id AND i.list_id = ${listId}
    `);
  }

  async itemIdsOf(listId: string, itemIds: readonly string[]): Promise<string[]> {
    if (itemIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({ id: listItem.id })
      .from(listItem)
      .where(and(eq(listItem.listId, listId), inArray(listItem.id, [...itemIds])))
      .orderBy(asc(listItem.sortOrder));

    return rows.map((row) => row.id);
  }
}
