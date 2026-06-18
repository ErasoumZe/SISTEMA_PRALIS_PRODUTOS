import { z } from 'zod/v4';

export const registerSchema = z.object({
  name: z.string().min(1, 'Informe o nome'),
  email: z.email('E-mail inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
});
export type RegisterRequest = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});
export type LoginRequest = z.infer<typeof loginSchema>;
