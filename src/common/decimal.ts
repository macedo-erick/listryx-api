import { z } from 'zod';

export function decimalString(scale: number): z.ZodType<string> {
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${String(scale)}})?$`);

  return z
    .union([z.number(), z.string()])
    .transform((value) => (typeof value === 'number' ? value.toFixed(scale) : value.trim()))
    .refine((value) => pattern.test(value), {
      message: `must be a non-negative amount with at most ${String(scale)} decimal places`,
    });
}

export function optionalDecimal(scale: number): z.ZodType<string | null | undefined> {
  return decimalString(scale).nullish();
}
