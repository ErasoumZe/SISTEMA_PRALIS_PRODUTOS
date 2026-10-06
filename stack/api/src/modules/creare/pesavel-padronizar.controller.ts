import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import { buildResponse } from '@/config/api.replies';
import { PesavelPadronizarService, type LojaPadronizar } from './pesavel-padronizar.service';

/** Mesma guarda das outras ações de Manutenção: quem tem a tela. */
@injectable()
export class PesavelPadronizarController {
  constructor(@inject(PesavelPadronizarService) private service: PesavelPadronizarService) {}

  async previa(request: FastifyRequest<{ Querystring: { loja: LojaPadronizar } }>, reply: FastifyReply) {
    exigirTela(request.currentUser, 'manutencao');
    return reply.send(buildResponse(await this.service.previa(request.query.loja), 'Prévia sem gravação.'));
  }

  async aplicar(
    request: FastifyRequest<{ Body: { loja: LojaPadronizar; confirmacao: string; hashPlano: string } }>,
    reply: FastifyReply,
  ) {
    exigirTela(request.currentUser, 'manutencao');
    const { loja, confirmacao, hashPlano } = request.body;
    const r = await this.service.aplicar(loja, confirmacao, hashPlano);
    return reply.send(buildResponse(
      r,
      `${r.gravados} ativo(s) agora pesáveis (${r.invertidos} deixaram de ser N); ${r.espelhosCorrigidos} espelho(s) SIA corrigidos.`,
    ));
  }
}
