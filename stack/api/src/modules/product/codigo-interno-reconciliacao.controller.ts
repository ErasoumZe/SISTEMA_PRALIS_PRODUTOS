import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CurrentUser } from '@/types/fastify-jwt';
import { AppError, buildResponse } from '@/config/api.replies';
import { CodigoInternoReconciliacaoService } from './codigo-interno-reconciliacao.service';

@injectable()
export class CodigoInternoReconciliacaoController {
  constructor(@inject(CodigoInternoReconciliacaoService) private service: CodigoInternoReconciliacaoService) {}
  private admin(request: FastifyRequest): CurrentUser {
    const user = request.currentUser;
    if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
    if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
    return user;
  }
  async previa(request: FastifyRequest, reply: FastifyReply) {
    this.admin(request);
    return reply.status(200).send(buildResponse(await this.service.previa(), 'Prévia da reconciliação'));
  }
  async aplicar(request: FastifyRequest<{ Body: { confirmacao: string } }>, reply: FastifyReply) {
    const user = this.admin(request);
    return reply.status(200).send(buildResponse(
      await this.service.aplicar(user, request.body.confirmacao),
      'Códigos reconciliados com trilha de auditoria',
    ));
  }
}
