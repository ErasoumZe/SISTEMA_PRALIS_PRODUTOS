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
    maxAge: 60 * 60 * 24 * 7, // 7 dias
  };
}

@injectable()
export class AuthController {
  constructor(@inject(AuthService) private service: AuthService) {}

  async register(request: FastifyRequest<{ Body: AuthRequests.RegisterRequest }>, reply: FastifyReply) {
    const user = await this.service.register(request.body);
    return reply.status(201).send(buildResponse(user, 'Conta criada com sucesso'));
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
