import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { apiResponseSchema, buildResponse } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';
import { TaxRuleService } from './tax-rule.service';

const ruleSchema = z.object({
  grupo: z.string(),
  cstPisCofins: z.string(),
  tributacaoSimples: z.string(),
  aliquotaSimples: z.number(),
  icmsRe: z.number(),
  baseFiscal: z.string(),
});

const classificationSchema = ruleSchema.extend({
  ncm: z.string().nullable(),
  codigoFiscal: z.string().nullable(),
  produtoFiscal: z.string().nullable(),
  cstReforma: z.string().nullable(),
  cClassTrib: z.string().nullable(),
  aliquotaIbs: z.number().nullable(),
  aliquotaCbs: z.number().nullable(),
  origem: z.enum(['produto', 'plu_balanca', 'grupo']),
});

export async function apoioRoutes(app: FastifyInstance) {
  const service = container.resolve(TaxRuleService);
  app.addHook('onRequest', authMiddleware);
  app.get('/apoio/grupos-fiscais', {
    schema: {
      response: { 200: apiResponseSchema(z.array(ruleSchema)) },
      summary: 'Grupos e regras fiscais vigentes',
      tags: ['APOIO'],
    },
  }, async (_request, reply) => reply.send(buildResponse(await service.list(), 'Regras fiscais por grupo')));
  app.get('/apoio/classificacao-fiscal', {
    schema: {
      querystring: z.object({ grupo: z.string().min(1), codigoBarras: z.string().optional() }),
      response: { 200: apiResponseSchema(classificationSchema) },
      summary: 'Classificação fiscal automática por grupo e código de barras',
      tags: ['APOIO'],
    },
  }, async (request, reply) => {
    const query = request.query as { grupo: string; codigoBarras?: string };
    return reply.send(buildResponse(await service.classify(query.grupo, query.codigoBarras), 'Classificação fiscal'));
  });
}
