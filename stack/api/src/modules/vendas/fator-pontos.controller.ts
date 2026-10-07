import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { VendasGerentesPeriodo, type FatorPontosSchemas } from '@pralis/shared';
import { buildResponse } from '@/config/api.replies';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import { AppError } from '@/config/api.replies';
import { FatorPontosService } from './fator-pontos.service';

/** A tela que libera esta configuração. Uma só, para consultar e para gravar. */
export const TELA_FATOR_PONTOS = 'fator-pontos';

/**
 * A régua de pontos.
 *
 * DUAS GUARDAS, de propósito: a tela precisa estar liberada para a pessoa E
 * ela precisa ser administrador. Mudar a régua muda a pontuação de todo mundo
 * em todas as telas; é a configuração mais destrutiva da área de vendas, e o
 * pedido do José foi explícito — "quem for admin e tiver a permissão ligada".
 */
@injectable()
export class FatorPontosController {
  constructor(@inject(FatorPontosService) private service: FatorPontosService) {}

  private guarda(request: FastifyRequest) {
    const user = exigirTela(request.currentUser, TELA_FATOR_PONTOS);
    if (user.role !== 'admin') {
      throw new AppError('Só um administrador muda a régua de pontos.', 403, 'FORBIDDEN');
    }
    return user;
  }

  async consultar(
    request: FastifyRequest<{ Querystring: FatorPontosSchemas.FatorPontosQuery }>,
    reply: FastifyReply,
  ) {
    this.guarda(request);
    const loja = request.query.loja ?? 'TNP';
    const dados = await this.service.consultar(loja, VendasGerentesPeriodo.hojeSaoPaulo());
    return reply.status(200).send(buildResponse(dados, 'Régua de pontos'));
  }

  async salvar(
    request: FastifyRequest<{ Body: FatorPontosSchemas.SalvarFatorBody }>,
    reply: FastifyReply,
  ) {
    const user = this.guarda(request);
    const versao = await this.service.salvar(request.body, user.email ?? null);
    return reply.status(200).send(buildResponse(
      versao,
      `Régua de ${versao.loja} valendo a partir de ${versao.vigenciaInicio}.`,
    ));
  }

  async apagar(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    this.guarda(request);
    await this.service.apagar(request.params.id);
    return reply.status(200).send(buildResponse(null, 'Vigência apagada.'));
  }
}
