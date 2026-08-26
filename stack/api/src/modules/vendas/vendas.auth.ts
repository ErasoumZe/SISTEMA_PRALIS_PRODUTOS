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

/** Aceita o token da automação ou uma sessão web de administrador. */
export async function vendasImportAuth(request: FastifyRequest, reply: FastifyReply) {
  const authorization = request.headers.authorization ?? '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    if (!env.VENDAS_IMPORT_TOKEN || env.VENDAS_IMPORT_TOKEN.length < 32) {
      return deny(reply, 503, 'Importação automática não configurada.');
    }
    if (!safeEqual(bearer, env.VENDAS_IMPORT_TOKEN)) return deny(reply, 401, 'Token de importação inválido.');
    return;
  }

  await authMiddleware(request, reply);
  if (reply.sent) return;
  if (request.currentUser?.role !== 'admin') return deny(reply, 403, 'Acesso restrito a administradores.');
}

