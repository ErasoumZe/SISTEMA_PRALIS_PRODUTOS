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
import { VendasReportController } from './vendas-report.controller';
import { VendasSchemas } from '@pralis/shared';

export async function vendasRoutes(app: FastifyInstance) {
  const controller = container.resolve(VendasController);
  const reportController = container.resolve(VendasReportController);
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
}
