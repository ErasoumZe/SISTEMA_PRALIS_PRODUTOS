import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ProductRequests } from '@pralis/shared';
import { ProductSheetController } from './product-sheet.controller';
import { ProductSheetLojaController } from './product-sheet-loja.controller';
import { apiResponseSchema } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';

export async function productSheetRoutes(app: FastifyInstance) {
  const controller = container.resolve(ProductSheetController);
  const loja = container.resolve(ProductSheetLojaController);
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
}
