import { FastifyReply, FastifyRequest } from 'fastify';
import { inject, injectable } from 'tsyringe';
import { AuthService } from './auth.service';
import { AuthRequests } from '@pralis/shared';
import { buildResponse } from '@/config/api.replies';
import { env } from '@/config/env';

const COOKIE = 'access_token';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV !== 'dev',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  };
}

@injectable()
export class AuthController {
  constructor(@inject(AuthService) private service: AuthService) {}

  async register(request: FastifyRequest<{ Body: AuthRequests.RegisterRequest }>, reply: FastifyReply) {
    const result = await this.service.register(request.body);
    return reply.status(201).send(buildResponse(result, 'Enviamos um código para o seu e-mail. Confirme para ativar a conta.'));
  }

  async verify(request: FastifyRequest<{ Body: AuthRequests.VerifyEmailRequest }>, reply: FastifyReply) {
    const { user, sessionId } = await this.service.verifyEmail(request.body.email, request.body.code);
    const token = await reply.jwtSign({ sub: user.id, sessionId });
    reply.setCookie(COOKIE, token, cookieOptions());
    return reply.status(200).send(buildResponse(user, 'E-mail confirmado! Bem-vindo(a).'));
  }

  async resend(request: FastifyRequest<{ Body: AuthRequests.ResendCodeRequest }>, reply: FastifyReply) {
    await this.service.resendCode(request.body.email);
    return reply.status(200).send(buildResponse(null, 'Se a conta existir, um novo código foi enviado.'));
  }

  async forgotPassword(request: FastifyRequest<{ Body: AuthRequests.ForgotPasswordRequest }>, reply: FastifyReply) {
    await this.service.forgotPassword(request.body.email);
    return reply.status(200).send(buildResponse(null, 'Se a conta existir, enviamos um código de recuperação.'));
  }

  async resetPassword(request: FastifyRequest<{ Body: AuthRequests.ResetPasswordRequest }>, reply: FastifyReply) {
    await this.service.resetPassword(request.body.email, request.body.code, request.body.password);
    return reply.status(200).send(buildResponse(null, 'Senha redefinida! Faça login com a nova senha.'));
  }

  async login(request: FastifyRequest<{ Body: AuthRequests.LoginRequest }>, reply: FastifyReply) {
    const { user, sessionId } = await this.service.login(request.body.email, request.body.password);
    const token = await reply.jwtSign({ sub: user.id, sessionId });
    reply.setCookie(COOKIE, token, cookieOptions());
    return reply.status(200).send(buildResponse(user, 'Login efetuado'));
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const sessionId = request.user?.sessionId;
    if (sessionId) await this.service.logout(sessionId);
    reply.clearCookie(COOKIE, { path: '/' });
    return reply.status(200).send(buildResponse(null, 'Logout efetuado'));
  }

  async me(request: FastifyRequest, reply: FastifyReply) {
    const user = await this.service.me(request.user.sub);
    return reply.status(200).send(buildResponse(user, 'Usuário atual'));
  }
}
