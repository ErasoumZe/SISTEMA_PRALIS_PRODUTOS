import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { VendasReportService } from './vendas-report.service';
import type { VendasSchemas, VendasPdv } from '@pralis/shared';
import type { VendasRanking } from '@pralis/shared';
import { VendasRankingService } from './vendas-ranking.service';
import { podeVerDinheiro, semDinheiro } from './vendas-ranking-sigilo';
import type { VendasAbc } from '@pralis/shared';
import { VendasAbcService } from './vendas-abc.service';
import { VendasReportRepository } from './vendas-report.repository';
import { montarPulso } from './vendas-pulso';
import { VendasPdvService } from './vendas-pdv.service';

type VendasReportQuery = VendasSchemas.VendasReportQuery;

export function reportStore(request: FastifyRequest, requested?: 'TNP' | 'LI'): 'TNP' | 'LI' {
  const user = request.currentUser;
  if (!user) throw new AppError('Não autenticado.', 401, 'UNAUTHENTICATED');
  if (user.role === 'admin') {
    if (!requested) throw new AppError('Administrador deve informar a loja.', 400, 'STORE_REQUIRED');
    return requested;
  }
  if (user.loja !== 'TNP' && user.loja !== 'LI') throw new AppError('Loja sem relatório nesta etapa.', 403, 'STORE_NOT_SUPPORTED');
  if (requested && requested !== user.loja) throw new AppError('Você só pode consultar sua loja.', 403, 'FORBIDDEN');
  return user.loja;
}

@injectable()
export class VendasReportController {
  constructor(@inject(VendasReportService) private service: VendasReportService) {}

  async report(request: FastifyRequest<{ Querystring: VendasReportQuery }>, reply: FastifyReply) {
    const store = reportStore(request, request.query.loja);
    const data = await this.service.report(store, request.query.inicio, request.query.fim);
    return reply.status(200).send(buildResponse(data, 'Relatório de vendas'));
  }
}


/**
 * Ranking por dimensão — produto, grupo, setor ou PDV.
 *
 * Controller próprio, ao lado do relatório, porque compartilha a MESMA regra de
 * qual loja a pessoa pode consultar (`reportStore`). Duplicar essa regra seria
 * a porta para um usuário de loja ler a outra por uma rota nova.
 */
@injectable()
export class VendasRankingController {
  constructor(@inject(VendasRankingService) private service: VendasRankingService) {}

  async ranking(
    request: FastifyRequest<{ Querystring: VendasRanking.VendasRankingQuery }>,
    reply: FastifyReply,
  ) {
    const store = reportStore(request, request.query.loja);
    const data = await this.service.ranking(
      store,
      request.query.inicio,
      request.query.fim,
      request.query.dimensao,
      request.query.campoSetor,
    );
    /*
     * O corte do dinheiro acontece AQUI, na saída, e não na tela.
     *
     * O painel de setores fica num monitor à vista de quem trabalha no salão.
     * Esconder a coluna no HTML deixaria o número viajando na resposta — basta
     * abrir o navegador para lê-lo. Quem não pode ver, não recebe.
     */
    const visivel = podeVerDinheiro(request.currentUser)
      ? data
      : semDinheiro(data);
    return reply.status(200).send(buildResponse(visivel, 'Ranking de vendas'));
  }
}

@injectable()
export class VendasPdvController {
  constructor(@inject(VendasPdvService) private service: VendasPdvService) {}

  async detalhe(request: FastifyRequest<{ Querystring: VendasPdv.DetalhePdvQuery }>, reply: FastifyReply) {
    const store = reportStore(request, request.query.loja);
    const data = await this.service.detalhe(store, request.query, podeVerDinheiro(request.currentUser));
    return reply.status(200).send(buildResponse(data, 'Detalhe do PDV'));
  }
}

/**
 * A lista de produtos da curva ABC. Controller próprio, mesma regra de loja.
 */
@injectable()
export class VendasAbcController {
  constructor(@inject(VendasAbcService) private service: VendasAbcService) {}

  async produtos(
    request: FastifyRequest<{ Querystring: VendasAbc.AbcProdutosQuery }>,
    reply: FastifyReply,
  ) {
    const store = request.query.loja === 'BASE'
      ? (() => {
        if (request.currentUser?.role !== 'admin') {
          throw new AppError('Catálogo Base disponível apenas para administradores.', 403, 'FORBIDDEN');
        }
        return 'BASE' as const;
      })()
      : reportStore(request, request.query.loja);
    const data = await this.service.produtos(
      store, request.query.inicio, request.query.fim, request.query.classe,
    );
    return reply.status(200).send(buildResponse(data, 'Produtos da curva ABC'));
  }
}

/**
 * O pulso da importação. Aberto a qualquer sessão autenticada de propósito:
 * é sinal de saúde do sistema, não dado de negócio — não traz valor nenhum,
 * só datas. Quem vê a tela de vendas precisa saber que o dado está velho.
 */
@injectable()
export class VendasPulsoController {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  async pulso(request: FastifyRequest, reply: FastifyReply) {
    if (!request.currentUser) throw new AppError('Não autenticado.', 401, 'UNAUTHENTICATED');
    const leituras = await this.repository.pulsoDasFontes();
    /* Data pelo relógio do servidor, em UTC — a mesma base das colunas `date`. */
    const hoje = new Date().toISOString().slice(0, 10);
    return reply.status(200).send(buildResponse(montarPulso(leituras, hoje), 'Pulso da importação'));
  }
}
