import { FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { AuthRepository } from '@/modules/auth/auth.repository';

const unauthorized = (reply: FastifyReply, message: string) =>
  reply.status(401).send({ message, data: null, details: null });

/** Exige autenticação; carrega o usuário (loja/papel) em request.currentUser. */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies.access_token;
  if (!token) return unauthorized(reply, 'Acesso negado. Faça login.');

  try {
    await request.jwtVerify();
    const { sub, sessionId } = request.user;
    if (!sessionId) return unauthorized(reply, 'Token malformado.');

    const authRepository = container.resolve(AuthRepository);
    const validSession = await authRepository.findValidSession(sessionId);
    if (!validSession) return unauthorized(reply, 'Sessão expirada. Faça login novamente.');

    const user = await authRepository.findById(sub);
    if (!user || !user.isActive) return unauthorized(reply, 'Usuário inválido.');

    request.currentUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      loja: (user.loja ?? null) as 'TNP' | 'LI' | 'HORA' | null,
      role: user.role as 'admin' | 'user',
    };
  } catch {
    return unauthorized(reply, 'Não autorizado. Token inválido.');
  }
}
