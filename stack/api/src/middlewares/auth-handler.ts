import { FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { AuthRepository } from '@/modules/auth/auth.repository';

const unauthorized = (reply: FastifyReply, message: string) =>
  reply.status(401).send({ message, data: null, details: null });

/** Exige autenticação: cookie access_token válido + sessão ativa no banco. */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies.access_token;
  if (!token) return unauthorized(reply, 'Acesso negado. Faça login.');

  try {
    await request.jwtVerify();
    const { sessionId } = request.user;
    if (!sessionId) return unauthorized(reply, 'Token malformado.');

    const authRepository = container.resolve(AuthRepository);
    const validSession = await authRepository.findValidSession(sessionId);
    if (!validSession) return unauthorized(reply, 'Sessão expirada. Faça login novamente.');
  } catch {
    return unauthorized(reply, 'Não autorizado. Token inválido.');
  }
}
