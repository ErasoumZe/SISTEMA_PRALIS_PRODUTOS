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
import { VendasReportController, VendasRankingController, VendasGerentesController, VendasPdvController, VendasAbcController, VendasPulsoController, VendasListaController } from './vendas-report.controller';
import { VendasDeParaController } from './vendas-depara.controller';
import { VendasUnicosController } from './vendas-unicos.controller';
import { z } from 'zod/v4';
import { VendasSchemas, VendasDePara, VendasUnicos, VendasRanking, VendasGerentes, VendasPdv, VendasAbc, VendasPulso, VendasLista } from '@pralis/shared';

export async function vendasRoutes(app: FastifyInstance) {
  const controller = container.resolve(VendasController);
  const reportController = container.resolve(VendasReportController);
  const rankingController = container.resolve(VendasRankingController);
  const gerentesController = container.resolve(VendasGerentesController);
  const pdvController = container.resolve(VendasPdvController);
  const abcController = container.resolve(VendasAbcController);
  const pulsoController = container.resolve(VendasPulsoController);
  const listaController = container.resolve(VendasListaController);
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

  typed.get<{ Querystring: VendasGerentes.GerentesQuery }>(
    '/vendas/gerentes',
    {
      preHandler: [authMiddleware],
      schema: {
        querystring: VendasGerentes.gerentesQuerySchema,
        response: { 200: apiResponseSchema(VendasGerentes.gerentesSchema) },
        summary: 'Pontuação diária por PDV para gerentes',
        tags: ['VENDAS'],
      },
    },
    gerentesController.relatorio.bind(gerentesController),
  );

  typed.get<{ Querystring: VendasPdv.DetalhePdvQuery }>(
    '/vendas/pdv/detalhe',
    {
      preHandler: [authMiddleware],
      schema: {
        querystring: VendasPdv.detalhePdvQuerySchema,
        response: { 200: apiResponseSchema(VendasPdv.detalhePdvSchema) },
        summary: 'Produtos comprovadamente vinculados a um dispositivo/PDV',
        tags: ['VENDAS'],
      },
    },
    pdvController.detalhe.bind(pdvController),
  );

  /*
   * A LISTA DE VENDAS, cupom a cupom, e o detalhe de um cupom.
   *
   * Existem só sobre `venda_item_pdv`: as tabelas diárias não sabem o que é
   * "uma venda". A tela relê a lista a cada poucos segundos — o que ela chama
   * de tempo real é isso, e a latência é do robô, não desta rota.
   */
  typed.get<{ Querystring: VendasLista.ListaVendasQuery }>(
    '/vendas/lista',
    {
      preHandler: [authMiddleware],
      schema: {
        querystring: VendasLista.listaVendasQuerySchema,
        response: { 200: apiResponseSchema(VendasLista.listaVendasSchema) },
        summary: 'Vendas do período, uma por cupom, com hora e PDV comprovados',
        tags: ['VENDAS'],
      },
    },
    listaController.lista.bind(listaController),
  );

  typed.get<{ Querystring: VendasLista.VendaDetalheQuery }>(
    '/vendas/venda',
    {
      preHandler: [authMiddleware],
      schema: {
        querystring: VendasLista.vendaDetalheQuerySchema,
        response: { 200: apiResponseSchema(VendasLista.vendaDetalheSchema) },
        summary: 'Itens de uma venda, pelo ID original do ERP',
        tags: ['VENDAS'],
      },
    },
    listaController.detalhe.bind(listaController),
  );

  /*
   * A LISTA da curva ABC — quais produtos, não quanto cada classe fatura.
   *
   * Separada do relatório porque a pergunta é outra e o custo também: esta
   * cruza a venda inteira com o cadastro, produto a produto, e quem abre o
   * resumo da curva não deve pagar por isso.
   */
  typed.get<{ Querystring: VendasAbc.AbcProdutosQuery }>(
    '/vendas/curva-abc',
    {
      preHandler: [authMiddleware],
      schema: {
        querystring: VendasAbc.abcProdutosQuerySchema,
        response: { 200: apiResponseSchema(VendasAbc.abcProdutosSchema) },
        summary: 'Produtos de cada classe da curva ABC, com dados do cadastro',
        tags: ['VENDAS'],
      },
    },
    abcController.produtos.bind(abcController),
  );

  /*
   * O PULSO: faz quanto tempo que não chega lote do robô.
   *
   * Existe por um caso real — o robô parou e ninguém percebeu por seis dias.
   * Relatório vazio não grita: ele só parece um dia fraco. Esta porta é o que
   * permite a tela avisar em vez de esperar alguém estranhar.
   */
  typed.get(
    '/vendas/pulso',
    {
      preHandler: [authMiddleware],
      schema: {
        response: { 200: apiResponseSchema(VendasPulso.pulsoSchema) },
        summary: 'Há quanto tempo cada fonte de vendas não recebe lote',
        tags: ['VENDAS'],
      },
    },
    pulsoController.pulso.bind(pulsoController),
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
