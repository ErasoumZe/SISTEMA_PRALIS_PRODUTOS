import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authMiddleware } from '@/middlewares/auth-handler';
import { UnificacaoController } from './unificacao.controller';

export async function unificacaoRoutes(app: FastifyInstance) {
  const controller = container.resolve(UnificacaoController);
  const typed = app.withTypeProvider<ZodTypeProvider>();
  app.addHook('onRequest', authMiddleware);

  typed.post(
    '/admin/unificacao/carregar',
    {
      schema: {
        summary: 'Recarregar o staging das 4 fontes + a base viva do Pralis (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.carregar.bind(controller),
  );

  typed.get(
    '/admin/unificacao/health',
    {
      schema: {
        summary: 'Contagem por fonte no staging da unificação (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.health.bind(controller),
  );
}
