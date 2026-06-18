import { z } from 'zod/v4';
import { loja, userRole } from '../product/product.enums';

export const userSchema = z.object({
  id: z.uuidv7(),
  name: z.string(),
  email: z.string(),
  loja,
  role: userRole,
  isActive: z.boolean(),
});
export type UserEntity = z.infer<typeof userSchema>;
