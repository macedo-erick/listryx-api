import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';

import { DATABASE, type Database } from '../database/db';
import { listTemplate, listTemplateItem } from '../database/schema';
import type { TemplateItemResponse, TemplateQuery, TemplateSummaryResponse } from './dto';

export interface TemplateItemSource {
  readonly text: string;
  readonly defaultQuantity: string | null;
  readonly sortOrder: number;
}

@Injectable()
export class TemplateRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findSummaries(
    ownerId: string,
    query: TemplateQuery,
  ): Promise<{ content: TemplateSummaryResponse[]; totalElements: number }> {
    const rows = await this.db.execute<TemplateSummaryResponse>(sql`
      SELECT
        t.id,
        t.name,
        (to_jsonb(t.created_at) #>> '{}') AS "createdAt",
        COUNT(i.id)::int AS "itemCount"
      FROM list_template t
      LEFT JOIN list_template_item i ON i.template_id = t.id
      WHERE t.owner_id = ${ownerId}
      GROUP BY t.id
      ORDER BY t.name
      LIMIT ${query.size} OFFSET ${query.page * query.size}
    `);

    const counted = await this.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM list_template WHERE owner_id = ${ownerId}
    `);

    return { content: [...rows], totalElements: counted[0]?.count ?? 0 };
  }

  async findSummary(
    ownerId: string,
    templateId: string,
  ): Promise<TemplateSummaryResponse | undefined> {
    const rows = await this.db.execute<TemplateSummaryResponse>(sql`
      SELECT
        t.id,
        t.name,
        (to_jsonb(t.created_at) #>> '{}') AS "createdAt",
        COUNT(i.id)::int AS "itemCount"
      FROM list_template t
      LEFT JOIN list_template_item i ON i.template_id = t.id
      WHERE t.owner_id = ${ownerId} AND t.id = ${templateId}
      GROUP BY t.id
    `);

    return rows[0];
  }

  async findItems(templateId: string): Promise<TemplateItemResponse[]> {
    const rows = await this.db
      .select({
        id: listTemplateItem.id,
        text: listTemplateItem.text,
        defaultQuantity: listTemplateItem.defaultQuantity,
        sortOrder: listTemplateItem.sortOrder,
      })
      .from(listTemplateItem)
      .where(eq(listTemplateItem.templateId, templateId))
      .orderBy(asc(listTemplateItem.sortOrder), asc(listTemplateItem.id));

    return rows;
  }

  async findItemsForOwner(
    ownerId: string,
    templateId: string,
  ): Promise<TemplateItemSource[] | null> {
    const owned = await this.db
      .select({ id: listTemplate.id })
      .from(listTemplate)
      .where(and(eq(listTemplate.ownerId, ownerId), eq(listTemplate.id, templateId)))
      .limit(1);

    if (owned.length === 0) {
      return null;
    }

    return this.findItems(templateId);
  }

  async exists(ownerId: string, templateId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: listTemplate.id })
      .from(listTemplate)
      .where(and(eq(listTemplate.ownerId, ownerId), eq(listTemplate.id, templateId)))
      .limit(1);

    return rows.length > 0;
  }

  async delete(ownerId: string, templateId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(listTemplate)
      .where(and(eq(listTemplate.ownerId, ownerId), eq(listTemplate.id, templateId)))
      .returning({ id: listTemplate.id });

    return deleted.length > 0;
  }
}
