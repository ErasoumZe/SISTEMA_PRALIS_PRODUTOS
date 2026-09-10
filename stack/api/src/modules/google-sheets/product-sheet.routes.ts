import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ProductRequests } from '@pralis/shared';
import { ProductSheetController } from './product-sheet.controller';
import { ProductSheetLojaController } from './product-sheet-loja.controller';
import { ReconciliacaoController } from './reconciliacao.controller';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from './reconciliacao.service';
import { apiResponseSchema } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';

export async function productSheetRoutes(app: FastifyInstance) {
  const controller = container.resolve(ProductSheetController);
  const loja = container.resolve(ProductSheetLojaController);
  const reconciliacao = container.resolve(ReconciliacaoController);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // autenticação obrigatória; o controller exige papel admin
  app.addHook('onRequest', authMiddleware);

  const syncReply = apiResponseSchema(
    z.object({
      status: z.enum(['synced', 'failed', 'disabled', 'skipped', 'misconfigured']),
      rowNumber: z.number().nullable(),
      error: z.string().nullable(),
    }),
  );

  const healthReply = apiResponseSchema(
    z.object({
      enabled: z.boolean(),
      configFaltando: z.array(z.string()),
      configOk: z.boolean(),
      spreadsheetId: z.string(),
      sheetName: z.string(),
      auth: z.boolean(),
      spreadsheetAcessivel: z.boolean(),
      abaEncontrada: z.boolean(),
      sheetId: z.number().nullable(),
      cabecalhos: z.array(
        z.object({
          coluna: z.string(),
          esperado: z.string(),
          encontrado: z.string(),
          ok: z.boolean(),
        }),
      ),
      cabecalhosOk: z.boolean(),
      abas: z.array(
        z.object({
          loja: z.string(),
          titulo: z.string(),
          encontrada: z.boolean(),
          colunas: z.number(),
          colunaId: z.string().nullable(),
          colunaFoto: z.string().nullable(),
          pronta: z.boolean(),
          faltando: z.array(z.string()),
        }),
      ),
      ok: z.boolean(),
      erro: z.string().optional(),
    }),
  );

  a.post<{ Params: { id: string } }>(
    '/admin/products/:id/sync-sheet',
    {
      schema: {
        params: ProductRequests.productIdParamSchema,
        response: { 200: syncReply },
        summary: 'Reprocessar o espelhamento do produto na planilha (idempotente)',
        tags: ['ADMIN', 'SHEETS'],
      },
    },
    controller.sync.bind(controller),
  );

  // ---- espelho nas abas de LOJA (TNP e LI; HORA fica de fora) ----
  const lojaQuery = z.object({
    productId: z.string().min(1),
    loja: z.enum(['TNP', 'LI']),
  });

  /*
   * Conferencia ANTES de gravar: numa aba editada a mao, ver celula por
   * celula vale mais que desfazer depois. E GET de proposito — nao escreve.
   */
  a.get<{ Querystring: z.infer<typeof lojaQuery> }>(
    '/admin/sheets/loja/previsualizar',
    {
      schema: {
        querystring: lojaQuery,
        summary: 'Conferir o que o espelho gravaria na aba da loja, sem gravar',
        tags: ['ADMIN', 'SHEETS'],
      },
    },
    loja.previsualizar.bind(loja),
  );

  a.post<{ Body: z.infer<typeof lojaQuery> }>(
    '/admin/sheets/loja/espelhar',
    {
      schema: {
        body: lojaQuery,
        summary: 'Gravar o produto na aba da loja (um por vez)',
        tags: ['ADMIN', 'SHEETS'],
      },
    },
    loja.espelhar.bind(loja),
  );

  a.get(
    '/admin/sheets/health',
    {
      schema: {
        response: { 200: healthReply },
        summary: 'Diagnóstico da integração com a planilha (somente leitura)',
        tags: ['ADMIN', 'SHEETS'],
      },
    },
    controller.health.bind(controller),
  );

  // ---- reconciliação banco x planilha (SOMENTE LEITURA) ----
  const reconciliacaoQuery = z.object({
    /*
     * Corta cada lista, nunca as contagens. `coerce` porque querystring chega
     * como texto; o serviço ainda limita ao teto, então mandar 99999 na mão
     * não derruba a resposta.
     */
    limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).optional().default(LIMITE_PADRAO),
  });

  const reconciliacaoReply = apiResponseSchema(
    z.object({
      estado: z.enum(['ok', 'desligado', 'sem-destino', 'sem-credencial', 'sem-aba', 'sem-coluna', 'falhou']),
      mensagem: z.string(),
      spreadsheetId: z.string(),
      aba: z.string(),
      colunaId: z.string().nullable(),
      colunaNome: z.string().nullable(),
      resumo: z.object({
        produtosNoBanco: z.number(),
        linhasComProduto: z.number(),
        linhasComId: z.number(),
        semLinhaNaPlanilha: z.number(),
        linhasOrfas: z.number(),
        linhasSemId: z.number(),
        nomeDivergente: z.number(),
        limite: z.number(),
        truncado: z.boolean(),
      }),
      semLinhaNaPlanilha: z.array(z.object({
        produtoId: z.string(),
        codigo: z.string(),
        codigoInterno: z.string().nullable(),
        nome: z.string(),
      })),
      linhasOrfas: z.array(z.object({
        linha: z.number(),
        id: z.string(),
        nome: z.string(),
      })),
      linhasSemId: z.array(z.object({
        linha: z.number(),
        nome: z.string(),
      })),
      nomeDivergente: z.array(z.object({
        produtoId: z.string(),
        linha: z.number(),
        nomeNoBanco: z.string(),
        nomeNaPlanilha: z.string(),
      })),
    }),
  );

  /*
   * GET de propósito, e sem nenhuma rota de "corrigir" ao lado: o valor deste
   * relatório é dizer a verdade sobre a divergência. Consertar é decisão de
   * quem lê, pelos caminhos que já existem.
   */
  a.get<{ Querystring: z.infer<typeof reconciliacaoQuery> }>(
    '/admin/produtos/reconciliacao',
    {
      schema: {
        querystring: reconciliacaoQuery,
        response: { 200: reconciliacaoReply },
        summary: 'Divergências entre o catálogo do banco e a planilha (somente leitura)',
        tags: ['ADMIN', 'SHEETS'],
      },
    },
    reconciliacao.relatorio.bind(reconciliacao),
  );
}
