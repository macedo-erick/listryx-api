/* eslint-disable @typescript-eslint/consistent-type-definitions -- db.execute<T> needs the implicit index signature only a type alias has. */
import { z } from 'zod';

export const itemPricesQuerySchema = z.object({
  text: z.string().trim().min(1).max(500),
});
export type ItemPricesQuery = z.infer<typeof itemPricesQuerySchema>;

export const listTotalsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type ListTotalsQuery = z.infer<typeof listTotalsQuerySchema>;

export type PricedItemResponse = {
  readonly text: string;
  readonly observationCount: number;
  readonly latestPrice: string;
  readonly latestAt: string;
};

export type ItemPricePointResponse = {
  readonly at: string;
  readonly unitPrice: string;
  readonly listId: string;
  readonly listName: string;
};

export type ListTotalPointResponse = {
  readonly listId: string;
  readonly name: string;
  readonly at: string;
  readonly total: string;
  readonly itemCount: number;
};
