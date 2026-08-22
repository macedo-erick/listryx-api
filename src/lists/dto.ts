/* eslint-disable @typescript-eslint/consistent-type-definitions -- db.execute<T> needs the implicit index signature only a type alias has. */
import { z } from 'zod';

import { decimalString, optionalDecimal } from '../common/decimal';
import { LIST_STATUSES } from '../database/schema';

export const createListSchema = z.object({
  name: z.string().trim().min(1).max(255),
  templateId: z.uuid().optional(),
});
export type CreateListRequest = z.infer<typeof createListSchema>;

export const renameListSchema = z.object({
  name: z.string().trim().min(1).max(255),
});
export type RenameListRequest = z.infer<typeof renameListSchema>;

export const listQuerySchema = z.object({
  status: z.enum(LIST_STATUSES).optional(),
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const createItemSchema = z.object({
  text: z.string().trim().min(1).max(500),
  quantity: optionalDecimal(2),
  unitPrice: optionalDecimal(2),
});
export type CreateItemRequest = z.infer<typeof createItemSchema>;

export const updateItemSchema = z
  .object({
    text: z.string().trim().min(1).max(500).optional(),
    quantity: optionalDecimal(2),
    unitPrice: optionalDecimal(2),
    checked: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be given',
  });
export type UpdateItemRequest = z.infer<typeof updateItemSchema>;

export const reorderItemsSchema = z.object({
  itemIds: z.array(z.uuid()).min(1),
});
export type ReorderItemsRequest = z.infer<typeof reorderItemsSchema>;

export const saveAsTemplateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  templateId: z.uuid().optional(),
});
export type SaveAsTemplateRequest = z.infer<typeof saveAsTemplateSchema>;

export const quantitySchema = decimalString(2);

export type ListItemResponse = {
  readonly id: string;
  readonly text: string;
  readonly quantity: string | null;
  readonly unitPrice: string | null;
  readonly subtotal: string | null;
  readonly checked: boolean;
  readonly sortOrder: number;
};

export type ListSummaryResponse = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly templateId: string | null;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly itemCount: number;
  readonly checkedCount: number;
  readonly pricedItemCount: number;
  readonly total: string | null;
  readonly checkedTotal: string | null;
};

export type ListResponse = ListSummaryResponse & {
  readonly items: readonly ListItemResponse[];
};
