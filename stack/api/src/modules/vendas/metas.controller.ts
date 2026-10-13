import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { MetasSchemas } from '@pralis/shared';
import { AppError, buildResponse } from '@/config/api.replies';
import { env } from '@/config/env';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import { MetasService } from './metas.service';
import { lojaGerentes } from './vendas-gerentes-acesso';

export const TELA_METAS_GERENTES = 'vendas-gerentes';

/**
 * Metas do Relatório Gerentes, servidas em PONTOS.
 *
 * Mora aqui e não no relatório de vendas porque é tela de gerente: quem olha é
 * quem responde pela meta do turno. E ponto é a unidade daquela tela inteira,
 * não reais.
 *
 * A loja vem de `lojaGerentes()`, a mesma guarda do resto do relatório: cada
 * conta vê a loja da sessão, e as duas contas nomeadas escolhem entre TNP e LI.
 * Mesmo para administrador, este contrato entrega os cards somente em pontos:
 * a tela é um placar de metas, não um relatório financeiro.
 */
@injectable()
export class MetasController {
  constructor(@inject(MetasService) private service: MetasService) {}

  /** Administrar metas exige as duas coisas: papel admin e acesso ao relatório. */
  private administradorComAcesso(request: FastifyRequest) {
    const user = exigirTela(request.currentUser, TELA_METAS_GERENTES);
    if (user.role !== 'admin') {
      throw new AppError('Apenas administrador pode alterar as metas.', 403, 'FORBIDDEN');
    }
    return user;
  }

  async consultar(request: FastifyRequest<{ Querystring: MetasSchemas.MetasQuery }>, reply: FastifyReply) {
    const loja = lojaGerentes(request.currentUser, request.query.loja, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    const dados = await this.service.consultar(loja, request.query, false);
    return reply.status(200).send(buildResponse(dados, 'Metas por turno'));
  }

  /** Gerar é decisão de dono, não de quem acompanha: a rota exige administrador. */
  async gerar(request: FastifyRequest<{ Body: MetasSchemas.GerarMatrizBody }>, reply: FastifyReply) {
    const user = this.administradorComAcesso(request);
    const loja = lojaGerentes(user, request.body.loja, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    const resultado = await this.service.gerar({ ...request.body, loja }, user.email);
    return reply.status(200).send(buildResponse(
      resultado,
      resultado.gravada ? 'Matriz de metas gravada' : 'Prévia da matriz de metas',
    ));
  }

  /** Importar é uma decisão administrativa e nunca recebe token de robô. */
  async importarPlanilhaTnp(
    request: FastifyRequest<{ Body: MetasSchemas.ImportarMetasPlanilhaTnpBody }>, reply: FastifyReply,
  ) {
    const user = this.administradorComAcesso(request);
    const loja = lojaGerentes(user, 'TNP', env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    if (loja !== 'TNP') throw new AppError('Loja inválida para esta importação.', 403, 'FORBIDDEN');
    const resultado = await this.service.importarPlanilhaTnp(request.body, user.email);
    return reply.status(200).send(buildResponse(
      resultado,
      resultado.aplicada ? 'Metas da planilha congeladas por data.' : 'Prévia da importação de metas.',
    ));
  }
}
