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
}
