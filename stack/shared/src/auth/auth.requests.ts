import { z } from 'zod/v4';
import { loja } from '../product/product.enums';

export const registerSchema = z.object({
  name: z.string().min(1, 'Informe o nome'),
  email: z.email('E-mail inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  // loja onde o usuário trabalha (TNP/LI/HORA). Opcional: o admin não tem loja
  // (o servidor exige a loja para contas comuns).
  loja: loja.optional(),
});
export type RegisterRequest = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});
export type LoginRequest = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({
  email: z.email('E-mail inválido'),
  code: z.string().length(6, 'O código tem 6 dígitos'),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailSchema>;

export const resendCodeSchema = z.object({
  email: z.email('E-mail inválido'),
});
export type ResendCodeRequest = z.infer<typeof resendCodeSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email('E-mail inválido'),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  email: z.email('E-mail inválido'),
  code: z.string().length(6, 'O código tem 6 dígitos'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;
