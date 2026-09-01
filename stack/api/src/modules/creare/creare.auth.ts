import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '@/config/env';
import { authMiddleware } from '@/middlewares/auth-handler';

const deny = (reply: FastifyReply, status: number, message: string) =>
  reply.status(status).send({ message, data: null, details: null });

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Aceita o token da automação da loja OU uma sessão web.
 *
 * O robô do SIA roda agendado às 22:30, sem ninguém logado — por isso o token.
 * Mesmo desenho do `vendasImportAuth`: comparação em tempo constante, e token
 * curto demais desabilita o caminho de máquina em vez de enfraquecê-lo.
 */
export async function creareExportAuth(request: FastifyRequest, reply: FastifyReply) {
  const authorization = request.headers.authorization ?? '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    if (!env.CREARE_EXPORT_TOKEN || env.CREARE_EXPORT_TOKEN.length < 32) {
      return deny(reply, 503, 'Download por token não configurado.');
    }
    if (!safeEqual(bearer, env.CREARE_EXPORT_TOKEN)) return deny(reply, 401, 'Token de exportação inválido.');
    return;
  }

  await authMiddleware(request, reply);
}
