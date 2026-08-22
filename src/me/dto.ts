import { z } from 'zod';

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(255),
  lastName: z.string().trim().max(255).default(''),
  email: z.email().trim().max(255),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;

export interface ProfileResponse {
  readonly username: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly emailVerified: boolean;
}
