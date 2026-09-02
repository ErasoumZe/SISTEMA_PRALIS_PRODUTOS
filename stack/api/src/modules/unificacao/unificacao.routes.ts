import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authMiddleware } from '@/middlewares/auth-handler';
import { UnificacaoController } from './unificacao.controller';

/**
 * Os filtros são do SERVIDOR. A tela manda o que o usuário escolheu e recebe só
 * a página — nunca os ~4.300 grupos para peneirar no navegador.
 */
const gruposQuerySchema = z.object({
  filtro: z.enum(['mesmo_cod_barras', 'mesmo_cod_interno', 'nome_parecido', 'unico']).optional(),
  loja: z.enum(['LI', 'TNP', 'BASE', 'HORA']).optional(),
  status: z.enum(['ativo', 'inativo']).optional(),
  revisar: z.coerce.boolean().optional(),
  semFiscalTnp: z.coerce.boolean().optional(),
  semGrupo: z.coerce.boolean().optional(),
  q: z.string().optional(),
  decisao: z.enum(['pendente', 'feita']).optional(),
  pagina: z.coerce.number().int().positive().optional(),
  tamanho: z.coerce.number().int().positive().max(200).optional(),
});

export async function unificacaoRoutes(app: FastifyInstance) {
  const controller = container.resolve(UnificacaoController);
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', authMiddleware);

  typed.post(
    '/admin/unificacao/carregar',
    {
      schema: {
        summary: 'Recarregar o staging das 4 fontes + Pralis e reagrupar (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.carregar.bind(controller),
  );

  typed.post(
    '/admin/unificacao/recalcular',
    {
      schema: {
        summary: 'Reagrupar sem recarregar os arquivos, preservando decisões (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.recalcular.bind(controller),
  );

  typed.get<{ Querystring: z.infer<typeof gruposQuerySchema> }>(
    '/admin/unificacao/grupos',
    {
      schema: {
        querystring: gruposQuerySchema,
        summary: 'Listar grupos de reconciliação, paginado e filtrado no servidor (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.listarGrupos.bind(controller),
  );

  typed.get(
    '/admin/unificacao/health',
    {
      schema: {
        summary: 'Contagem por fonte e totais dos grupos (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.health.bind(controller),
  );
}
