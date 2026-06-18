import { z } from 'zod/v4';
import { userRole } from '../product/product.enums';

/** Promover/rebaixar um usuário (admin <-> user). */
export const updateRoleSchema = z.object({
  role: userRole,
});
export type UpdateRoleRequest = z.infer<typeof updateRoleSchema>;

export const adminUserIdParamSchema = z.object({ id: z.string().min(1) });
export type AdminUserIdParam = z.infer<typeof adminUserIdParamSchema>;
