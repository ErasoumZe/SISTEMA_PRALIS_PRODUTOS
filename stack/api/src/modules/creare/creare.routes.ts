import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authMiddleware } from '@/middlewares/auth-handler';
import { CreareController } from './creare.controller';
import { creareExportAuth } from './creare.auth';
import { DeParaUploadController } from './depara-upload.controller';

const exportQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI', 'HORA']).optional(),
  /** Primeira execução real: gerar poucos produtos, conferir no log, e só então liberar tudo. */
  limite: z.coerce.number().int().positive().max(100000).optional(),
  modo: z.enum(['completo', 'pendentes']).optional(),
});
const confirmQuerySchema = z.object({ loja: z.enum(['TNP', 'LI', 'HORA']) });
const confirmBodySchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) });

export async function creareRoutes(app: FastifyInstance) {
  const controller = container.resolve(CreareController);
  const deParaController = container.resolve(DeParaUploadController);
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

  typed.post<{
    Params: { id: string };
    Querystring: z.infer<typeof confirmQuerySchema>;
    Body: z.infer<typeof confirmBodySchema>;
  }>(
    '/creare/lotes/:id/confirmar',
    {
      preHandler: [creareExportAuth],
      schema: {
        params: z.object({ id: z.uuid() }),
        querystring: confirmQuerySchema,
        body: confirmBodySchema,
        summary: 'Confirmar lote SOMENTE apos conferir importacao no SIA',
        tags: ['CREARE'],
      },
    },
    controller.confirm.bind(controller),
  );

  typed.get<{ Querystring: z.infer<typeof confirmQuerySchema> }>(
    '/creare/lotes/pendente',
    {
      preHandler: [creareExportAuth],
      schema: {
        querystring: confirmQuerySchema,
        summary: 'Consultar identificador e hash do lote pendente, sem gerar novo lote',
        tags: ['CREARE'],
      },
    },
    controller.openBatch.bind(controller),
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

  /*
   * ---- Importar o de-para do SIA pela tela ----
   *
   * Existia só `npm run creare:depara`, que precisa de shell e da credencial do
   * banco de produção — ou seja, a régua da numeração dependia de um
   * desenvolvedor com acesso ao servidor, e o catálogo do SIA muda toda semana.
   *
   * A prévia confere sem gravar; aplicar substitui o de-para da loja inteiro.
   * As recusas (barras ambíguas, coditem repetido) são as mesmas do script,
   * porque vêm do parser compartilhado.
   *
   * Sem `response` declarado de propósito: multipart + schema de resposta do
   * Zod brigam na serialização, e o envelope já é o padrão da casa.
   */
  typed.post(
    '/admin/creare/depara/previa',
    {
      preHandler: [authMiddleware],
      schema: {
        consumes: ['multipart/form-data'],
        summary: 'Conferir uma exportação do SIA sem gravar (admin)',
        tags: ['ADMIN', 'CREARE'],
      },
    },
    deParaController.previa.bind(deParaController),
  );

  typed.post(
    '/admin/creare/depara',
    {
      preHandler: [authMiddleware],
      schema: {
        consumes: ['multipart/form-data'],
        summary: 'Substituir o de-para do SIA de uma loja (admin)',
        tags: ['ADMIN', 'CREARE'],
      },
    },
    deParaController.aplicar.bind(deParaController),
  );
}
