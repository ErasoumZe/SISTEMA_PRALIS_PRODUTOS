import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Telas } from '@pralis/shared';
import { AppError, buildResponse } from '@/config/api.replies';
import { PermissaoService } from './permissao.service';

@injectable()
export class PermissaoController {
  constructor(@inject(PermissaoService) private service: PermissaoService) {}

  private exigirLogado(request: FastifyRequest) {
    const user = request.currentUser;
    if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
    return user;
  }

  async painel(request: FastifyRequest, reply: FastifyReply) {
    const painel = await this.service.painel(this.exigirLogado(request));
    const geridas = painel.pessoas.filter((p) => p.gerenciavel).length;
    return reply.status(200).send(buildResponse(
      painel,
      `${painel.pessoas.length} pessoa(s), ${painel.telas.length} telas — você pode alterar ${geridas}.`,
    ));
  }

  async alternar(
    request: FastifyRequest<{ Body: { userId: string; telaId: string; permitido: boolean } }>,
    reply: FastifyReply,
  ) {
    const user = this.exigirLogado(request);
    const r = await this.service.alternar(user, request.body);
    const tela = Telas.telaPorId(request.body.telaId);
    return reply.status(200).send(buildResponse(
      r,
      `"${tela?.titulo ?? request.body.telaId}" ${request.body.permitido ? 'liberada' : 'bloqueada'}.`,
    ));
  }
}
