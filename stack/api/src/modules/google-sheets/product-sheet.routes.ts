import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ProductRequests } from '@pralis/shared';
import { ProductSheetController } from './product-sheet.controller';
import { apiResponseSchema } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';

export async function productSheetRoutes(app: FastifyInstance) {
  const controller = container.resolve(ProductSheetController);
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
