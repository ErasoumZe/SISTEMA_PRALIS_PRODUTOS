import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MetasSchemas } from '@pralis/shared';
import { buildResponse } from '@/config/api.replies';
import { env } from '@/config/env';
import { MetasService } from './metas.service';
import { lojaGerentes } from './vendas-gerentes-acesso';

/**
 * A tela de metas é inteira em reais: meta, realizado e diferença.
 *
 * Então o acesso segue a mesma regra do ranking (`vendas-ranking-sigilo.ts`):
 * quem não pode ver dinheiro não recebe. Não existe versão "sem valores" desta
 * tela — ela não sobraria nada. O corte é na API, não no HTML, senão o número
 * continua viajando na resposta e qualquer pessoa o lê no navegador.
 *
 * A loja vem de `lojaGerentes()`, a mesma guarda do Relatório Gerentes: cada
 * conta vê a loja da sessão, e as duas contas nomeadas escolhem entre TNP e LI.
 */
@injectable()
export class MetasController {
  constructor(@inject(MetasService) private service: MetasService) {}

  async consultar(request: FastifyRequest<{ Querystring: MetasSchemas.MetasQuery }>, reply: FastifyReply) {
    const loja = lojaGerentes(request.currentUser, request.query.loja, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    const dados = await this.service.consultar(loja, request.query);
    return reply.status(200).send(buildResponse(dados, 'Metas por turno'));
  }

  async gerar(request: FastifyRequest<{ Body: MetasSchemas.GerarMatrizBody }>, reply: FastifyReply) {
    const loja = lojaGerentes(request.currentUser, request.body.loja, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    const resultado = await this.service.gerar({ ...request.body, loja }, request.currentUser?.email);
    return reply.status(200).send(buildResponse(
      resultado,
      resultado.gravada ? 'Matriz de metas gravada' : 'Prévia da matriz de metas',
    ));
  }
}
