import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MetasSchemas } from '@pralis/shared';
import { buildResponse } from '@/config/api.replies';
import { env } from '@/config/env';
import { MetasService } from './metas.service';
import { lojaGerentes } from './vendas-gerentes-acesso';
import { podeVerDinheiro } from './vendas-ranking-sigilo';

/**
 * Metas do Relatório Gerentes, servidas em PONTOS.
 *
 * Mora aqui e não no relatório de vendas porque é tela de gerente: quem olha é
 * quem responde pela meta do turno. E ponto é a unidade daquela tela inteira,
 * não reais.
 *
 * A loja vem de `lojaGerentes()`, a mesma guarda do resto do relatório: cada
 * conta vê a loja da sessão, e as duas contas nomeadas escolhem entre TNP e LI.
 * O valor em reais só acompanha para quem pode ver dinheiro — e, como
 * `vendas-ranking-sigilo.ts` já avisa, isso tira o número da resposta sem
 * tornar o faturamento indedutível, porque ponto é faturamento × 0,25.
 */
@injectable()
export class MetasController {
  constructor(@inject(MetasService) private service: MetasService) {}

  async consultar(request: FastifyRequest<{ Querystring: MetasSchemas.MetasQuery }>, reply: FastifyReply) {
    const loja = lojaGerentes(request.currentUser, request.query.loja, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    const dados = await this.service.consultar(loja, request.query, podeVerDinheiro(request.currentUser));
    return reply.status(200).send(buildResponse(dados, 'Metas por turno'));
  }

  /** Gerar é decisão de dono, não de quem acompanha: a rota exige administrador. */
  async gerar(request: FastifyRequest<{ Body: MetasSchemas.GerarMatrizBody }>, reply: FastifyReply) {
    const loja = lojaGerentes(request.currentUser, request.body.loja, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    const resultado = await this.service.gerar({ ...request.body, loja }, request.currentUser?.email);
    return reply.status(200).send(buildResponse(
      resultado,
      resultado.gravada ? 'Matriz de metas gravada' : 'Prévia da matriz de metas',
    ));
  }
}
