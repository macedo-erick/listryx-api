import { z } from 'zod';

export const categorySchema: z.ZodType<string | null | undefined> = z
  .string()
  .trim()
  .max(100)
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) {
      return value;
    }

    return value === '' ? null : value;
  });
