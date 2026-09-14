import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { apiResponseSchema } from '@/config/api.replies';
import { VendasController } from './vendas.controller';
import {
  importarVendasBodySchema,
  importarVendasResultSchema,
  type ImportarVendasBody,
} from './vendas.schemas';
import { vendasImportAuth } from './vendas.auth';
import { authMiddleware } from '@/middlewares/auth-handler';
import { VendasReportController, VendasRankingController } from './vendas-report.controller';
import { VendasDeParaController } from './vendas-depara.controller';
import { VendasUnicosController } from './vendas-unicos.controller';
import { z } from 'zod/v4';
import { VendasSchemas, VendasDePara, VendasUnicos, VendasRanking } from '@pralis/shared';

export async function vendasRoutes(app: FastifyInstance) {
  const controller = container.resolve(VendasController);
  const reportController = container.resolve(VendasReportController);
  const rankingController = container.resolve(VendasRankingController);
  const deParaController = container.resolve(VendasDeParaController);
  const unicosController = container.resolve(VendasUnicosController);
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post<{ Body: ImportarVendasBody }>(
    '/vendas/importar',
    {
      preHandler: [vendasImportAuth],
      schema: {
        body: importarVendasBodySchema,
        response: { 200: apiResponseSchema(importarVendasResultSchema) },
        summary: 'Importar lote diário de vendas ou fechamentos (TNP/Lisboa)',
        tags: ['VENDAS'],
      },
      bodyLimit: 2 * 1024 * 1024,
    },
    controller.importar.bind(controller),
  );

  typed.get<{ Querystring: VendasSchemas.VendasReportQuery }>(
    '/vendas/relatorio',
    {
      preHandler: [authMiddleware],
      schema: {
        querystring: VendasSchemas.vendasReportQuerySchema,
        response: { 200: apiResponseSchema(VendasSchemas.vendasReportSchema) },
        summary: 'Relatório de vendas por loja e período',
        tags: ['VENDAS'],
      },
    },
    reportController.report.bind(reportController),
  );

  /*
   * Uma porta para as quatro dimensões, e não quatro portas.
   *
   * A conta é a mesma — somar faturamento por uma chave e ordenar —, e o que
   * muda é de onde a chave sai. Quatro rotas seriam quatro lugares para o
   * mesmo controle de qual loja a pessoa pode ler.
   */
  typed.get<{ Querystring: VendasRanking.VendasRankingQuery }>(
    '/vendas/ranking',
    {
      preHandler: [authMiddleware],
      schema: {
        querystring: VendasRanking.vendasRankingQuerySchema,
        response: { 200: apiResponseSchema(VendasRanking.vendasRankingSchema) },
        summary: 'Ranking de vendas por produto, grupo, setor ou PDV',
        tags: ['VENDAS'],
      },
    },
    rankingController.ranking.bind(rankingController),
  );

  typed.get<{ Querystring: VendasDePara.DeParaQuery }>(
    '/vendas/de-para',
    {
      preHandler: [authMiddleware],
      schema: {
        querystring: VendasDePara.deParaQuerySchema,
        response: { 200: apiResponseSchema(VendasDePara.deParaListaSchema) },
        summary: 'Códigos do PDV sem produto no cadastro, com sugestões',
        tags: ['VENDAS'],
      },
    },
    deParaController.pendentes.bind(deParaController),
  );

  typed.post<{ Body: VendasDePara.VincularBody }>(
    '/vendas/de-para',
    {
      preHandler: [authMiddleware],
      schema: {
        body: VendasDePara.vincularBodySchema,
        response: { 200: apiResponseSchema(z.null()) },
        summary: 'Confirmar (ou desfazer) o vínculo entre código do PDV e produto',
        tags: ['VENDAS'],
      },
    },
    deParaController.vincular.bind(deParaController),
  );

  typed.get<{ Querystring: VendasUnicos.ProdutosUnicosQuery }>(
    '/vendas/produtos-unicos',
    {
      preHandler: [authMiddleware],
      schema: {
        querystring: VendasUnicos.produtosUnicosQuerySchema,
        response: { 200: apiResponseSchema(VendasUnicos.produtosUnicosSchema) },
        summary: 'Produtos únicos vendidos no período (uma linha por produto)',
        tags: ['VENDAS'],
      },
    },
    unicosController.listar.bind(unicosController),
  );

  // CSV do período INTEIRO. Sem schema de resposta: devolve texto, não envelope.
  typed.get<{ Querystring: VendasUnicos.ProdutosUnicosCsvQuery }>(
    '/vendas/produtos-unicos.csv',
    {
      preHandler: [authMiddleware],
      schema: {
        querystring: VendasUnicos.produtosUnicosCsvQuerySchema,
        summary: 'Exportar os produtos vendidos no período em CSV para Excel',
        tags: ['VENDAS'],
      },
    },
    unicosController.csv.bind(unicosController),
  );
}
