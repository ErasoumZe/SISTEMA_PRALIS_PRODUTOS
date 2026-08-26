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
import { VendasDeParaController } from './vendas-depara.controller';
import { z } from 'zod/v4';
import { VendasSchemas, VendasDePara } from '@pralis/shared';

export async function vendasRoutes(app: FastifyInstance) {
  const controller = container.resolve(VendasController);
  const reportController = container.resolve(VendasReportController);
  const deParaController = container.resolve(VendasDeParaController);
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
}
