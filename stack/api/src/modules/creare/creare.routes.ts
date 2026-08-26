import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authMiddleware } from '@/middlewares/auth-handler';
import { CreareController } from './creare.controller';

const exportQuerySchema = z.object({ loja: z.enum(['TNP', 'LI', 'HORA']).optional() });

export async function creareRoutes(app: FastifyInstance) {
  const controller = container.resolve(CreareController);
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', authMiddleware);

  typed.get(
    '/creare/produtos.txt',
    {
      schema: {
        querystring: exportQuerySchema,
        summary: 'Baixar arquivo posicional de produtos da loja (363 posições)',
        tags: ['CREARE'],
      },
    },
    controller.export.bind(controller),
  );

  typed.get(
    '/admin/creare/health',
    {
      schema: {
        summary: 'Verificar feature flag e configuração Criare sem gerar arquivo',
        tags: ['ADMIN', 'CREARE'],
      },
    },
    controller.health.bind(controller),
  );
}

