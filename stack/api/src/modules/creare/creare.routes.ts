import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authMiddleware } from '@/middlewares/auth-handler';
import { CreareController } from './creare.controller';
import { creareExportAuth } from './creare.auth';

const exportQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI', 'HORA']).optional(),
  /** Primeira execução real: gerar poucos produtos, conferir no log, e só então liberar tudo. */
  limite: z.coerce.number().int().positive().max(100000).optional(),
});

export async function creareRoutes(app: FastifyInstance) {
  const controller = container.resolve(CreareController);
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get<{ Querystring: z.infer<typeof exportQuerySchema> }>(
    '/creare/produtos.txt',
    {
      // token de máquina OU sessão web — o robô da loja roda sem ninguém logado
      preHandler: [creareExportAuth],
      schema: {
        querystring: exportQuerySchema,
        summary: 'Baixar arquivo posicional de produtos da loja (363 posições)',
        tags: ['CREARE'],
      },
    },
    controller.export.bind(controller),
  );

  typed.get<{ Querystring: z.infer<typeof exportQuerySchema> }>(
    '/admin/creare/health',
    {
      // diagnóstico só com sessão: mostra amostra do catálogo
      preHandler: [authMiddleware],
      schema: {
        summary: 'Conferir de-para do SIA, casamento e distribuição de alíquota antes de importar',
        tags: ['ADMIN', 'CREARE'],
      },
    },
    controller.health.bind(controller),
  );
}
