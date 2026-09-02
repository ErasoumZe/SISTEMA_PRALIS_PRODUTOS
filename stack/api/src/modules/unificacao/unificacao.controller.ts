import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { UnificacaoService } from './unificacao.service';

function exigirAdmin(request: FastifyRequest): CurrentUser {
  const user = request.currentUser;
  if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
  if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
  return user;
}

@injectable()
export class UnificacaoController {
  constructor(@inject(UnificacaoService) private service: UnificacaoService) {}

  /** Apaga o staging e recarrega as 5 fontes. Não toca no catálogo vivo. */
  async carregar(request: FastifyRequest, reply: FastifyReply) {
    exigirAdmin(request);
    const health = await this.service.carregar();
    return reply.status(200).send(buildResponse(health, 'Fontes carregadas no staging'));
  }

  async health(request: FastifyRequest, reply: FastifyReply) {
    exigirAdmin(request);
    return reply.status(200).send(buildResponse(await this.service.health(), 'Staging da unificação'));
  }
}
