/* eslint-disable @typescript-eslint/consistent-type-definitions -- db.execute<T> needs the implicit index signature only a type alias has. */
import { z } from 'zod';

import { optionalDecimal } from '../common/decimal';

export const templateItemSchema = z.object({
  text: z.string().trim().min(1).max(500),
  defaultQuantity: optionalDecimal(2),
});

export const upsertTemplateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  items: z.array(templateItemSchema).max(500).default([]),
});
export type UpsertTemplateRequest = z.infer<typeof upsertTemplateSchema>;

export const templateQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(50),
});
export type TemplateQuery = z.infer<typeof templateQuerySchema>;

export type TemplateItemResponse = {
  readonly id: string;
  readonly text: string;
  readonly defaultQuantity: string | null;
  readonly sortOrder: number;
};

export type TemplateSummaryResponse = {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly itemCount: number;
};

export type TemplateResponse = TemplateSummaryResponse & {
  readonly items: readonly TemplateItemResponse[];
};
