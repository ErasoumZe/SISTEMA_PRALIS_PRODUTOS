import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { AppError, apiResponseSchema, buildResponse } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';
import { ReenvioSheetsService } from './reenvio.service';

/**
 * Plugin próprio, e não mais uma rota dentro de `product-sheet.routes.ts`, para
 * que o reenvio possa ser lido, testado e desligado sem passar pelo arquivo que
 * concentra o espelhamento.
 *
 * A rota é o gatilho MANUAL. O automático é um intervalo no `server.ts` — os
 * dois chamam o mesmo serviço, então o comportamento é um só.
 */
export async function reenvioRoutes(app: FastifyInstance) {
  const servico = container.resolve(ReenvioSheetsService);
  const a = app.withTypeProvider<ZodTypeProvider>();

  app.addHook('onRequest', authMiddleware);

  const exigirAdmin = (request: { currentUser?: { role: string } }) => {
    if (!request.currentUser) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
    if (request.currentUser.role !== 'admin') {
      throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
    }
  };

  const resultado = apiResponseSchema(z.object({
    tentados: z.number(), sincronizados: z.number(),
    falharam: z.number(), desistidos: z.number(),
  }));

  /** Quem está na fila agora, sem tentar nada. */
  a.get(
    '/admin/produtos/reenvio',
    {
      schema: {
        response: { 200: apiResponseSchema(z.object({ aguardando: z.number(), desistidos: z.number() })) },
        summary: 'Quantos produtos esperam reenvio para a planilha (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    async (request, reply) => {
      exigirAdmin(request);
      const aguardando = (await servico.aguardando(500)).length;
      const desistidos = await servico.desistidos();
      return reply.status(200).send(buildResponse(
        { aguardando, desistidos },
        `${aguardando} aguardando reenvio, ${desistidos} desistido(s)`,
      ));
    },
  );

  a.post(
    '/admin/produtos/reenvio',
    {
      schema: {
        body: z.object({ limite: z.number().int().min(1).max(200).optional() }),
        response: { 200: resultado },
        summary: 'Reenviar agora o que falhou (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    async (request, reply) => {
      exigirAdmin(request);
      const r = await servico.reprocessar(request.body.limite ?? 50);
      return reply.status(200).send(buildResponse(
        r,
        `${r.sincronizados} de ${r.tentados} reenviado(s) com sucesso`,
      ));
    },
  );
}
