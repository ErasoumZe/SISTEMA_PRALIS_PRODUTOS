import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import { buildResponse } from '@/config/api.replies';
import { PesavelPadronizarService, type LojaPadronizar } from './pesavel-padronizar.service';
import type { RegraBarrasProprias } from './pesavel-padronizar.plano';

/** Mesma guarda das outras ações de Manutenção: quem tem a tela. */
@injectable()
export class PesavelPadronizarController {
  constructor(@inject(PesavelPadronizarService) private service: PesavelPadronizarService) {}

  async previa(
    request: FastifyRequest<{ Querystring: { loja: LojaPadronizar; barrasProprias?: RegraBarrasProprias } }>,
    reply: FastifyReply,
  ) {
    exigirTela(request.currentUser, 'manutencao');
    const { loja, barrasProprias = 'pesavel' } = request.query;
    return reply.send(buildResponse(await this.service.previa(loja, { barrasProprias }), 'Prévia sem gravação.'));
  }

  async aplicar(
    request: FastifyRequest<{ Body: { loja: LojaPadronizar; confirmacao: string; hashPlano: string; barrasProprias?: RegraBarrasProprias } }>,
    reply: FastifyReply,
  ) {
    exigirTela(request.currentUser, 'manutencao');
    const { loja, confirmacao, hashPlano, barrasProprias = 'pesavel' } = request.body;
    const r = await this.service.aplicar(loja, confirmacao, hashPlano, { barrasProprias });
    return reply.send(buildResponse(
      r,
      `${r.paraS} ativo(s) agora pesáveis e ${r.paraN} não pesáveis por terem barras próprias; ${r.espelhosCorrigidos} espelho(s) SIA corrigidos.`,
    ));
  }
}
