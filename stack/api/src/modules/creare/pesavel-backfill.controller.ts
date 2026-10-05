import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import { buildResponse } from '@/config/api.replies';
import { PesavelBackfillService, type LojaBackfill } from './pesavel-backfill.service';

/** Mesma guarda da manutenção de pesáveis: quem tem a tela de Manutenção. */
@injectable()
export class PesavelBackfillController {
  constructor(@inject(PesavelBackfillService) private service: PesavelBackfillService) {}

  async previa(request: FastifyRequest<{ Querystring: { loja: LojaBackfill } }>, reply: FastifyReply) {
    exigirTela(request.currentUser, 'manutencao');
    return reply.send(buildResponse(await this.service.previa(request.query.loja), 'Prévia sem gravação.'));
  }

  async aplicar(
    request: FastifyRequest<{ Body: { loja: LojaBackfill; confirmacao: string; hashPlano: string } }>,
    reply: FastifyReply,
  ) {
    exigirTela(request.currentUser, 'manutencao');
    const { loja, confirmacao, hashPlano } = request.body;
    const r = await this.service.aplicar(loja, confirmacao, hashPlano);
    return reply.send(buildResponse(r, `${r.gravados} produto(s) classificados e ${r.completados} completados.`));
  }
}
