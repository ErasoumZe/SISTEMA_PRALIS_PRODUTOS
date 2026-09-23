import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { apiResponseSchema } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';
import { PermissaoController } from './permissao.controller';

export async function permissaoRoutes(app: FastifyInstance) {
  const controller = container.resolve(PermissaoController);
  const a = app.withTypeProvider<ZodTypeProvider>();

  app.addHook('onRequest', authMiddleware);

  const telaSchema = z.object({
    id: z.string(),
    titulo: z.string(),
    subtitulo: z.string(),
    path: z.string(),
    secao: z.string(),
    icone: z.string(),
    foraDoMenu: z.boolean().optional(),
    sempreLiberada: z.boolean().optional(),
  });

  const pessoaSchema = z.object({
    userId: z.string(),
    nome: z.string(),
    email: z.string(),
    role: z.enum(['admin', 'user']),
    loja: z.string().nullable(),
    ativo: z.boolean(),
    adminRaiz: z.boolean(),
    gerenciavel: z.boolean(),
    motivo: z.string().nullable(),
    telas: z.array(z.string()),
  });

  a.get(
    '/admin/permissoes',
    {
      schema: {
        response: {
          200: apiResponseSchema(z.object({
            telas: z.array(telaSchema),
            secoes: z.array(z.string()),
            sempreLiberadas: z.array(z.string()),
            pessoas: z.array(pessoaSchema),
          })),
        },
        summary: 'Quem enxerga cada tela',
        tags: ['ADMIN'],
      },
    },
    controller.painel.bind(controller),
  );

  a.post(
    '/admin/permissoes/alternar',
    {
      schema: {
        body: z.object({
          userId: z.string().min(1),
          telaId: z.string().min(1),
          permitido: z.boolean(),
        }),
        response: {
          200: apiResponseSchema(z.object({ userId: z.string(), telas: z.array(z.string()) })),
        },
        summary: 'Liberar ou bloquear uma tela para uma pessoa',
        tags: ['ADMIN'],
      },
    },
    controller.alternar.bind(controller),
  );
}
