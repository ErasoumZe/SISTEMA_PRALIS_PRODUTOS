import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ProductController } from './product.controller';
import { ProductExportController } from './product-export.controller';
import { ProductZerarController } from './product-zerar.controller';
import { CodigoCadastroController } from './codigo-cadastro.controller';
import { GiuliaSiaController } from './giulia-sia.controller';
import { BALDES_EM_LOTE } from './codigo-cadastro.service';
import { ImportarMixController } from './importar-mix.controller';
import { CustoMerController } from './custo-mer.controller';
import { HistoricalDuplicatesController } from './historical-duplicates.controller';
import { ProductRequests, ProductSchemas } from '@pralis/shared';
import { apiResponseSchema } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';

export async function productRoutes(app: FastifyInstance) {
  const controller = container.resolve(ProductController);
  const exportController = container.resolve(ProductExportController);
  const zerarController = container.resolve(ProductZerarController);
  const codigoCadastroController = container.resolve(CodigoCadastroController);
  const giuliaSiaController = container.resolve(GiuliaSiaController);
  const importarMixController = container.resolve(ImportarMixController);
  const custoMerController = container.resolve(CustoMerController);
  const historicalDuplicatesController = container.resolve(HistoricalDuplicatesController);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // todas as rotas exigem autenticação
  app.addHook('onRequest', authMiddleware);

  const productReply = apiResponseSchema(ProductSchemas.selectProductSchema);
  const productListReply = apiResponseSchema(z.array(ProductSchemas.selectProductSchema));
  const importReply = apiResponseSchema(z.object({
    imported: z.number(),
    skipped: z.number(),
    // faixa LI/TNP da aba geral (leiaute novo) ou aba dedicada (legado)
    espelhoLoja: z.enum(['desligado', 'sem-aba', 'espelhado', 'falhou']),
  }));
  const okReply = apiResponseSchema(z.any());

  a.get(
    '/admin/produtos/duplicados-historicos/previa',
    { schema: { summary: 'Confrontar códigos históricos 00001–00428 contra SIA 10000–13126', tags: ['ADMIN', 'PRODUTOS'] } },
    historicalDuplicatesController.previa.bind(historicalDuplicatesController),
  );

  a.post<{ Body: { perdedorId: string; vencedorId: string; codigoPerdedorEsperado: string; codigoVencedorEsperado: string; confirmacao: string } }>(
    '/admin/produtos/duplicados-historicos/unificar',
    {
      schema: {
        body: z.object({
          perdedorId: z.string().min(1), vencedorId: z.string().min(1),
          codigoPerdedorEsperado: z.string().min(1), codigoVencedorEsperado: z.string().min(1),
          confirmacao: z.string().min(1),
        }),
        summary: 'Unificar um cadastro histórico em seu equivalente SIA (admin)', tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    historicalDuplicatesController.unificar.bind(historicalDuplicatesController),
  );

  a.post<{ Body: { totalEsperado: number; confirmacao: string } }>(
    '/admin/produtos/duplicados-historicos/unificar-nomes-exatos',
    { schema: { body: z.object({ totalEsperado: z.number().int().min(1).max(100), confirmacao: z.string().min(1) }), summary: 'Unificar em lote nomes históricos exatamente iguais (admin)', tags: ['ADMIN', 'PRODUTOS'] } },
    historicalDuplicatesController.unificarNomesExatos.bind(historicalDuplicatesController),
  );

  a.post<{ Body: { itens: Array<{ perdedorId: string; vencedorId: string; codigoPerdedorEsperado: string; codigoVencedorEsperado: string; confirmacao: string }> } }>(
    '/admin/produtos/duplicados-historicos/unificar-revisados',
    { schema: { body: z.object({ itens: z.array(z.object({ perdedorId: z.string().min(1), vencedorId: z.string().min(1), codigoPerdedorEsperado: z.string().min(1), codigoVencedorEsperado: z.string().min(1), confirmacao: z.string().min(1) })).min(1).max(100) }), summary: 'Unificar em lote pares selecionados manualmente na revisão (admin)', tags: ['ADMIN', 'PRODUTOS'] } },
    historicalDuplicatesController.unificarRevisados.bind(historicalDuplicatesController),
  );

  a.post<{ Body: ProductRequests.CreateProductRequest }>(
    '/products',
    { schema: { body: ProductRequests.createProductSchema, response: { 201: productReply }, summary: 'Criar produto (na loja do usuário)', tags: ['PRODUCTS'] } },
    controller.create.bind(controller),
  );

  a.get<{ Querystring: ProductRequests.ListProductQuery }>(
    '/products',
    { schema: { querystring: ProductRequests.listProductQuerySchema, response: { 200: productListReply }, summary: 'Listar produtos da minha loja', tags: ['PRODUCTS'] } },
    controller.list.bind(controller),
  );

  a.get<{ Querystring: ProductRequests.ListProductQuery }>(
    '/products/base',
    { schema: { querystring: ProductRequests.listProductQuerySchema, response: { 200: productListReply }, summary: 'Listar o catálogo BASE (para importar)', tags: ['PRODUCTS'] } },
    controller.listBase.bind(controller),
  );

  a.post<{ Body: ProductRequests.ImportProductsRequest }>(
    '/products/import',
    { schema: { body: ProductRequests.importProductsSchema, response: { 200: importReply }, summary: 'Importar produtos da BASE para a minha loja', tags: ['PRODUCTS'] } },
    controller.importBase.bind(controller),
  );

  a.get(
    '/admin/produtos/historico-nomes',
    {
      schema: {
        response: { 200: apiResponseSchema(z.array(z.object({
          id: z.string(), productId: z.string(), loja: z.string(), codigo: z.string(),
          codigoInterno: z.string().nullable(), nomeAnterior: z.string(), nomeNovo: z.string(),
          alteradoPorNome: z.string().nullable(), alteradoEm: z.string(),
        }))) },
        summary: 'Listar alterações de nome dos produtos (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    controller.listNameHistory.bind(controller),
  );

  a.get<{ Params: { id: string } }>(
    '/products/:id',
    { schema: { params: ProductRequests.productIdParamSchema, response: { 200: productReply }, summary: 'Detalhe do produto', tags: ['PRODUCTS'] } },
    controller.getById.bind(controller),
  );

  a.put<{ Params: { id: string }; Body: ProductRequests.UpdateProductRequest }>(
    '/products/:id',
    { schema: { params: ProductRequests.productIdParamSchema, body: ProductRequests.updateProductSchema, response: { 200: productReply }, summary: 'Atualizar produto', tags: ['PRODUCTS'] } },
    controller.update.bind(controller),
  );

  a.delete<{ Params: { id: string } }>(
    '/products/:id',
    { schema: { params: ProductRequests.productIdParamSchema, response: { 200: okReply }, summary: 'Excluir produto', tags: ['PRODUCTS'] } },
    controller.delete.bind(controller),
  );

  a.post<{ Body: { ids: string[]; confirmacao: string } }>(
    '/products/excluir-lote',
    { schema: { body: z.object({ ids: z.array(z.string().min(1)).min(1).max(100), confirmacao: z.string().min(1) }), response: { 200: okReply }, summary: 'Excluir produtos selecionados (admin)', tags: ['PRODUCTS'] } },
    controller.deleteBatch.bind(controller),
  );

  // Só leitura. A resposta é o CSV cru, então a rota não declara `response`
  // (o schema de resposta padrão embrulharia o arquivo num envelope JSON).
  a.get(
    '/admin/produtos/export.csv',
    {
      schema: {
        summary: 'Exportar a base de produtos de TODAS as lojas em CSV (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    exportController.exportar.bind(exportController),
  );

  /*
   * Zerar o catálogo. Duas travas de propósito:
   *  - a frase digitada, porque clique errado acontece;
   *  - o total que a tela mostrava, porque se alguém cadastrou no meio o número
   *    muda e a operação para em vez de apagar mais do que foi decidido.
   *
   * A prévia é GET separado para a tela poder mostrar o número ANTES de
   * qualquer botão perigoso aparecer.
   */
  a.get(
    '/admin/produtos/zerar/previa',
    {
      schema: {
        response: { 200: apiResponseSchema(z.object({ total: z.number(), confirmacao: z.string() })) },
        summary: 'Quantos produtos seriam apagados (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    zerarController.previa.bind(zerarController),
  );

  a.post(
    '/admin/produtos/zerar',
    {
      schema: {
        body: z.object({
          confirmacao: z.string(),
          totalEsperado: z.number().int().nonnegative(),
        }),
        response: { 200: apiResponseSchema(z.object({ apagados: z.number() })) },
        summary: 'Apagar TODOS os produtos do catálogo (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    zerarController.zerar.bind(zerarController),
  );

  /*
   * ---- Código de cadastro × coditem do SIA ----
   *
   * A prévia é GET e não grava nada. Toda gravação exige a frase de
   * confirmação, e a adoção em lote cobre SÓ o balde `exato` (código de barras
   * casando com o SIA, sem outro produto disputando o mesmo código). O resto é
   * clique humano, item a item, com o código que a tela viu indo junto para
   * impedir que uma tela velha sobrescreva quem decidiu antes.
   */
  const baldeCodigo = z.enum([
    'ja-correto', 'exato', 'barras-tem-codigo', 'conflito-sia', 'disputado', 'fora-do-sia', 'novo',
  ]);
  const itemPrevia = z.object({
    productId: z.string(),
    loja: z.string(),
    nome: z.string(),
    codigoBarras: z.string().nullable(),
    codigoAtual: z.string().nullable(),
    balde: baldeCodigo,
    codigoProposto: z.string().nullable(),
    motivo: z.string(),
    candidatos: z.array(z.object({
      loja: z.string(), coditem: z.string(), descricao: z.string(), semelhanca: z.number().optional(),
    })),
  });

  a.get(
    '/admin/produtos/giulia-sia/previa',
    {
      schema: {
        response: { 200: apiResponseSchema(z.object({
          propostas: z.array(z.object({
            produto: z.object({ id: z.string(), loja: z.string(), nome: z.string(), codigoBarras: z.string().nullable(), codigoInterno: z.string().nullable() }),
            situacao: z.enum(['conciliar-sia', 'novo-codigo', 'pendente', 'conflito-sia']), codigoProposto: z.string().nullable(),
            candidatos: z.array(z.object({ loja: z.string(), coditem: z.string(), descricao: z.string(), ativo: z.string() })), motivo: z.string(),
          })),
          ultimoSiaAtivo: z.number(), maiorBanco: z.number(), teto: z.number(),
          resumo: z.object({ 'conciliar-sia': z.number(), 'novo-codigo': z.number(), pendente: z.number(), 'conflito-sia': z.number() }),
          confirmacao: z.string(), loteMaximo: z.number(),
        })) },
        summary: 'Prévia exclusiva por código de barras dos produtos da Giulia (admin)', tags: ['ADMIN', 'PRODUTOS'],
      },
    }, giuliaSiaController.previa.bind(giuliaSiaController),
  );

  a.post(
    '/admin/produtos/giulia-sia/aplicar',
    {
      schema: { body: z.object({ confirmacao: z.string() }), response: { 200: apiResponseSchema(z.object({ aplicadas: z.number(), conflitos: z.number(), restantes: z.number() })) }, summary: 'Aplicar reconciliação Giulia/SIA confirmada (admin)', tags: ['ADMIN', 'PRODUTOS'] },
    }, giuliaSiaController.aplicar.bind(giuliaSiaController),
  );

  a.get(
    '/admin/produtos/codigo-cadastro/previa',
    {
      schema: {
        response: {
          200: apiResponseSchema(z.object({
            resumo: z.record(baldeCodigo, z.number()),
            teto: z.number(),
            tetoDe: z.string(),
            paresSia: z.number(),
            planilha: z.object({ estado: z.string(), teto: z.number(), linhas: z.number() }),
            itens: z.array(itemPrevia),
            confirmacao: z.string(),
            loteMaximo: z.number(),
          })),
        },
        summary: 'Prévia da reconciliação do código de cadastro com o SIA (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    codigoCadastroController.previa.bind(codigoCadastroController),
  );

  a.post(
    '/admin/produtos/codigo-cadastro/adotar-exatos',
    {
      schema: {
        body: z.object({
          confirmacao: z.string(),
          /** Qual balde adotar. Ausente = `exato`, como era antes deste campo existir. */
          balde: z.enum(BALDES_EM_LOTE).optional(),
        }),
        response: {
          200: apiResponseSchema(z.object({
            aplicadas: z.number(), conflitos: z.number(), restantes: z.number(),
          })),
        },
        summary: 'Adotar em lote os códigos lidos do SIA ou do campo de barras (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    codigoCadastroController.adotarExatos.bind(codigoCadastroController),
  );

  a.post(
    '/admin/produtos/codigo-cadastro/decidir',
    {
      schema: {
        body: z.object({
          productId: z.string().min(1),
          codigo: z.string().optional(),
          cunhar: z.boolean().optional(),
          /** O que a tela mostrava: sem isso a guarda contra corrida não existe. */
          codigoAtualEsperado: z.string().nullable(),
          confirmacao: z.string(),
        }).refine((b) => !!b.cunhar !== !!b.codigo, {
          message: 'Escolha um código OU cunhe um novo — não os dois, nem nenhum.',
        }),
        response: { 200: apiResponseSchema(z.object({ codigo: z.string(), fonte: z.string() })) },
        summary: 'Decidir o código de um produto: adotar do SIA ou cunhar novo (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    codigoCadastroController.decidir.bind(codigoCadastroController),
  );

  /*
   * ---- Importar da planilha MIX para a Base ----
   *
   * Cria cadastro novo para o que existe na planilha e não no sistema. A regra
   * que manda: campo que a planilha não traz entra VAZIO, e linha sem o mínimo
   * para ser produto não entra — cada recusa vem com o motivo na prévia.
   * O fiscal NÃO vem daqui: quem preenche é o backfill, pela fonte aprovada.
   */
  const motivoPulo = z.enum([
    'codigo-invalido', 'codigo-repetido-na-planilha', 'sem-nome',
    'unidade-desconhecida', 'tipo-desconhecido', 'ja-existe-por-codigo', 'ja-existe-por-barras',
    'barras-repetida-na-planilha',
  ]);

  a.get(
    '/admin/produtos/importar-mix/previa',
    {
      schema: {
        response: {
          200: apiResponseSchema(z.object({
            estado: z.enum(['ok', 'sem-destino', 'sem-coluna', 'falhou']),
            truncada: z.boolean(),
            faltando: z.array(z.string()),
            erro: z.string().optional(),
            linhasLidas: z.number(),
            linhasDescartadas: z.number(),
            importar: z.number(),
            pular: z.record(motivoPulo, z.number()),
            amostra: z.array(z.object({
              linha: z.number(),
              codigo: z.string(),
              nome: z.string(),
              acao: z.enum(['importar', 'pular']),
              motivo: motivoPulo.optional(),
              produto: z.looseObject({}).optional(),
            })),
            confirmacao: z.string(),
            loteMaximo: z.number(),
          })),
        },
        summary: 'Prévia da importação de produtos da planilha MIX (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    importarMixController.previa.bind(importarMixController),
  );

  a.post(
    '/admin/produtos/importar-mix',
    {
      schema: {
        body: z.object({ confirmacao: z.string() }),
        response: {
          200: apiResponseSchema(z.object({
            criados: z.number(),
            restantes: z.number(),
            falhas: z.array(z.object({ linha: z.number(), codigo: z.string(), erro: z.string() })),
          })),
        },
        summary: 'Criar na Base os produtos que só existem na planilha MIX (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    importarMixController.importar.bind(importarMixController),
  );

  /*
   * ---- Custo, da base de discriminação de mercadorias ----
   *
   * Regra do DB-05 do backlog: o custo do produto é o da compra MAIS RECENTE
   * nessa base. Cada linha da aba é um lançamento, não um cadastro.
   */
  const motivoSemCusto = z.enum(['sem-lancamento', 'nome-ambiguo-no-cadastro', 'custo-ilegivel', 'ja-esta-certo']);
  const propostaCusto = z.object({
    productId: z.string(),
    nome: z.string(),
    custoAtual: z.number().nullable(),
    custoNovo: z.number().nullable(),
    custoUnitario: z.number().nullable(),
    qtCad: z.number(),
    fonte: z.string().nullable(),
    motivo: motivoSemCusto.optional(),
  });

  a.get(
    '/admin/produtos/custo-discriminacao/previa',
    {
      schema: {
        response: {
          200: apiResponseSchema(z.object({
            estado: z.enum(['ok', 'sem-destino', 'sem-coluna', 'falhou']),
            truncada: z.boolean(),
            faltando: z.array(z.string()),
            erro: z.string().optional(),
            linhaCabecalho: z.number().nullable(),
            lancamentos: z.number(),
            lancamentosDescartados: z.number(),
            comCusto: z.number(),
            semCusto: z.record(motivoSemCusto, z.number()),
            amostra: z.array(propostaCusto),
            confirmacao: z.string(),
            loteMaximo: z.number(),
          })),
        },
        summary: 'Prévia da carga de custo pela base de discriminação (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    custoMerController.previa.bind(custoMerController),
  );

  a.post(
    '/admin/produtos/custo-discriminacao',
    {
      schema: {
        body: z.object({ confirmacao: z.string() }),
        response: {
          200: apiResponseSchema(z.object({
            aplicados: z.number(), conflitos: z.number(), restantes: z.number(),
          })),
        },
        summary: 'Gravar o custo da compra mais recente em cada produto (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    custoMerController.aplicar.bind(custoMerController),
  );
}
