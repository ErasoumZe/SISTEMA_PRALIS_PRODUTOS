import { z } from 'zod/v4';
import { loja, userRole } from '../product/product.enums';

export const userSchema = z.object({
  id: z.uuidv7(),
  name: z.string(),
  email: z.string(),
  loja: loja.nullable(), // null para admin
  role: userRole,
  isActive: z.boolean(),
  /**
   * As telas que esta pessoa enxerga — só o `/auth/me` preenche.
   *
   * Opcional porque `login` e `verify` devolvem o mesmo schema e não carregam
   * permissão: quem monta o menu é o `me`, que roda logo depois.
   */
  telas: z.array(z.string()).optional(),
});
export type UserEntity = z.infer<typeof userSchema>;
