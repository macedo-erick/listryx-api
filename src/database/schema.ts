import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const listTemplate = pgTable(
  'list_template',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_list_template_owner_id').on(table.ownerId, table.name)],
);

export const listTemplateItem = pgTable(
  'list_template_item',
  {
    id: uuid('id').primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => listTemplate.id, { onDelete: 'cascade' }),
    text: varchar('text', { length: 500 }).notNull(),
    defaultQuantity: numeric('default_quantity', { precision: 10, scale: 2 }),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [index('idx_list_template_item_template_id').on(table.templateId, table.sortOrder)],
);

export const list = pgTable(
  'list',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 10 }).notNull().default('open'),
    templateId: uuid('template_id').references(() => listTemplate.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_list_owner_status').on(table.ownerId, table.status, table.createdAt.desc()),
    check('list_status_check', sql`${table.status} IN ('open', 'closed')`),
  ],
);

export const listItem = pgTable(
  'list_item',
  {
    id: uuid('id').primaryKey(),
    listId: uuid('list_id')
      .notNull()
      .references(() => list.id, { onDelete: 'cascade' }),
    text: varchar('text', { length: 500 }).notNull(),
    normalizedText: varchar('normalized_text', { length: 500 }).generatedAlwaysAs(
      sql`lower(btrim(text))`,
    ),
    quantity: numeric('quantity', { precision: 10, scale: 2 }),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
    checked: boolean('checked').notNull().default(false),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [
    index('idx_list_item_list_id').on(table.listId, table.sortOrder),
    index('idx_list_item_normalized_text')
      .on(table.normalizedText)
      .where(sql`unit_price IS NOT NULL`),
  ],
);

export type ListRow = typeof list.$inferSelect;
export type ListItemRow = typeof listItem.$inferSelect;
export type ListTemplateRow = typeof listTemplate.$inferSelect;
export type ListTemplateItemRow = typeof listTemplateItem.$inferSelect;

export const LIST_STATUSES = ['open', 'closed'] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];
