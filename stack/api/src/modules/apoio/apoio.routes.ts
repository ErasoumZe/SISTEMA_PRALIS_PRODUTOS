import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { apiResponseSchema, buildResponse, AppError } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';
import { TaxRuleService } from './tax-rule.service';
import { BackfillFiscalService } from './backfill-fiscal.service';

/**
 * O serializador do Zod remove tudo que não está declarado aqui — silenciosamente.
 *
 * Foi assim que a margem por grupo sumiu entre o serviço e a tela: o
 * `TaxRuleService` entregava `margemPadrao`, o `ProductForm` lia
 * `selectedTaxRule.margemPadrao`, e no meio o campo era descartado sem erro
 * nenhum. Campo novo no serviço precisa entrar TAMBÉM aqui.
 *
 * `nullable`, não `optional`: ausente e nulo têm significados diferentes —
 * nulo é "este grupo não tem margem definida", e zero é uma margem escolhida.
 */
const ruleSchema = z.object({
  grupo: z.string(),
  cstPisCofins: z.string(),
  tributacaoSimples: z.string(),
  aliquotaSimples: z.number(),
  icmsRe: z.number(),
  baseFiscal: z.string(),
  margemPadrao: z.number().nullable(),
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

  const backfill = container.resolve(BackfillFiscalService);
  const exigirAdmin = (request: { currentUser?: { role: string } }) => {
    if (!request.currentUser) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
    if (request.currentUser.role !== 'admin') {
      throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
    }
  };

  /** Quantos produtos há em cada estado fiscal. É o health do fiscal. */
  app.get('/admin/fiscal/panorama', {
    schema: {
      response: { 200: apiResponseSchema(z.record(z.string(), z.number())) },
      summary: 'Quantos produtos em cada estado fiscal (admin)',
      tags: ['ADMIN', 'FISCAL'],
    },
  }, async (request, reply) => {
    exigirAdmin(request);
    const panorama = await backfill.panorama();
    return reply.send(buildResponse(panorama, 'Panorama fiscal'));
  });

  /**
   * Completa a carga fiscal em lote.
   *
   * `aplicar` é FALSO por padrão e precisa vir explícito: reescrever fiscal de
   * mil produtos não pode ser o caminho fácil. Sem ele, a rota só relata.
   */
  app.post('/admin/fiscal/backfill', {
    schema: {
      body: z.object({
        aplicar: z.boolean().default(false),
        limite: z.number().int().min(1).max(500).optional(),
        cursor: z.string().optional(),
        loja: z.string().optional(),
        productId: z.string().optional(),
      }),
      response: {
        200: apiResponseSchema(z.object({
          aplicou: z.boolean(),
          analisados: z.number(),
          porEstado: z.record(z.string(), z.number()),
          alterados: z.array(z.object({
            id: z.string(), nome: z.string(), de: z.string(),
            para: z.string(), motivo: z.string(),
          })),
          proximoCursor: z.string().nullable(),
        })),
      },
      summary: 'Completar carga fiscal em lote — confere por padrão (admin)',
      tags: ['ADMIN', 'FISCAL'],
    },
  }, async (request, reply) => {
    exigirAdmin(request);
    const b = request.body as {
      aplicar: boolean; limite?: number; cursor?: string; loja?: string; productId?: string;
    };
    const r = await backfill.executar(
      { limite: b.limite, cursor: b.cursor, loja: b.loja, productId: b.productId },
      b.aplicar,
    );
    return reply.send(buildResponse(
      r,
      b.aplicar
        ? `${r.alterados.length} produto(s) atualizados de ${r.analisados} analisados`
        : `${r.alterados.length} de ${r.analisados} seriam atualizados (nada foi gravado)`,
    ));
  });
}
