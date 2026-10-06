import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import { buildResponse } from '@/config/api.replies';
import { PesavelBackfillService, type LojaBackfill } from './pesavel-backfill.service';
import type { PoliticaConflito } from './pesavel-backfill.plano';

/** Mesma guarda da manutenção de pesáveis: quem tem a tela de Manutenção. */
@injectable()
export class PesavelBackfillController {
  constructor(@inject(PesavelBackfillService) private service: PesavelBackfillService) {}

  async previa(
    request: FastifyRequest<{ Querystring: { loja: LojaBackfill; conflitos?: PoliticaConflito } }>,
    reply: FastifyReply,
  ) {
    exigirTela(request.currentUser, 'manutencao');
    const { loja, conflitos = 'bloquear' } = request.query;
    return reply.send(buildResponse(await this.service.previa(loja, { conflitos }), 'Prévia sem gravação.'));
  }

  async aplicar(
    request: FastifyRequest<{ Body: { loja: LojaBackfill; confirmacao: string; hashPlano: string; conflitos?: PoliticaConflito } }>,
    reply: FastifyReply,
  ) {
    exigirTela(request.currentUser, 'manutencao');
    const { loja, confirmacao, hashPlano, conflitos = 'bloquear' } = request.body;
    const r = await this.service.aplicar(loja, confirmacao, hashPlano, { conflitos });
    const corrigidos = r.espelhosCorrigidos ? ` ${r.espelhosCorrigidos} espelho(s) SIA corrigidos pelo cadastro.` : '';
    return reply.send(buildResponse(r, `${r.gravados} produto(s) classificados e ${r.completados} completados.${corrigidos}`));
  }
}
