import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { AuthController } from './auth.controller';
import { AuthRequests } from '@pralis/shared';
import { apiResponseSchema } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';

export async function authRoutes(app: FastifyInstance) {
  const controller = container.resolve(AuthController);
  const a = app.withTypeProvider<ZodTypeProvider>();

  const userReply = apiResponseSchema(
    z.object({
      id: z.string(), name: z.string(), email: z.string(),
      loja: z.string(), role: z.string(), isActive: z.boolean(),
    }),
  );
  const emailReply = apiResponseSchema(z.object({ email: z.string() }));
  const okReply = apiResponseSchema(z.any());

  a.post<{ Body: AuthRequests.RegisterRequest }>(
    '/auth/register',
    { schema: { body: AuthRequests.registerSchema, response: { 201: emailReply }, summary: 'Criar conta (envia código por e-mail)', tags: ['AUTH'] } },
    controller.register.bind(controller),
  );

  a.post<{ Body: AuthRequests.VerifyEmailRequest }>(
    '/auth/verify',
    { schema: { body: AuthRequests.verifyEmailSchema, response: { 200: userReply }, summary: 'Confirmar e-mail (código) e entrar', tags: ['AUTH'] } },
    controller.verify.bind(controller),
  );

  a.post<{ Body: AuthRequests.ResendCodeRequest }>(
    '/auth/resend',
    { schema: { body: AuthRequests.resendCodeSchema, response: { 200: okReply }, summary: 'Reenviar código', tags: ['AUTH'] } },
    controller.resend.bind(controller),
  );

  a.post<{ Body: AuthRequests.LoginRequest }>(
    '/auth/login',
    { schema: { body: AuthRequests.loginSchema, response: { 200: userReply }, summary: 'Login', tags: ['AUTH'] } },
    controller.login.bind(controller),
  );

  a.post(
    '/auth/logout',
    { preHandler: [authMiddleware], schema: { response: { 200: okReply }, summary: 'Logout', tags: ['AUTH'] } },
    controller.logout.bind(controller),
  );

  a.get(
    '/auth/me',
    { preHandler: [authMiddleware], schema: { response: { 200: userReply }, summary: 'Usuário atual', tags: ['AUTH'] } },
    controller.me.bind(controller),
  );
}
