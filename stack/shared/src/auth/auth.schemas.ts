import { z } from 'zod/v4';

export const userSchema = z.object({
  id: z.uuidv7(),
  name: z.string(),
  email: z.string(),
  isActive: z.boolean(),
});
export type UserEntity = z.infer<typeof userSchema>;
