import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authMiddleware } from '@/middlewares/auth-handler';
import { CreareController } from './creare.controller';
import { creareExportAuth } from './creare.auth';
import { DeParaUploadController } from './depara-upload.controller';
import { PesaveisMaintenanceController } from './pesaveis-maintenance.controller';
import { PesavelBackfillController } from './pesavel-backfill.controller';
import { PesavelPadronizarController } from './pesavel-padronizar.controller';

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
  const pesaveisController = container.resolve(PesaveisMaintenanceController);
  const backfillController = container.resolve(PesavelBackfillController);
  const padronizarController = container.resolve(PesavelPadronizarController);
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
    '/creare/lotes/:id/entrega',
    {
      preHandler: [creareExportAuth],
      schema: {
        params: z.object({ id: z.uuid() }),
        querystring: confirmQuerySchema,
        body: confirmBodySchema,
        summary: 'Registrar TXT salvo e verificado no PC, sem declarar importacao no SIA',
        tags: ['CREARE'],
      },
    },
    controller.acknowledgeDelivery.bind(controller),
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
        summary: 'Consultar lote ainda nao salvo pelo robo, sem gerar outro',
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

  typed.post('/admin/creare/pesaveis/previa', {
    preHandler: [authMiddleware],
    schema: { consumes: ['multipart/form-data'], summary: 'Conferir pesáveis da exportação TNP sem gravar', tags: ['ADMIN', 'CREARE'] },
  }, pesaveisController.previa.bind(pesaveisController));

  typed.post('/admin/creare/pesaveis/aplicar', {
    preHandler: [authMiddleware],
    schema: { consumes: ['multipart/form-data'], summary: 'Alinhar pesáveis TNP por código interno após prévia', tags: ['ADMIN', 'CREARE'] },
  }, pesaveisController.aplicar.bind(pesaveisController));

  /*
   * Backfill de pesável: classifica quem ainda não tem valor, copiando o
   * espelho SIA quando ele diz, e aplicando o default N quando ninguém diz.
   * Em 05/10/2026 isso era 95% da TNP travada no TXT.
   */
  const politicaConflito = z.enum(['bloquear', 'manterCadastro']).optional();
  typed.get<{ Querystring: { loja: 'TNP' | 'LI'; conflitos?: 'bloquear' | 'manterCadastro' } }>('/admin/creare/pesavel-backfill/previa', {
    preHandler: [authMiddleware],
    schema: {
      querystring: z.object({ loja: z.enum(['TNP', 'LI']), conflitos: politicaConflito }),
      summary: 'Conferir, sem gravar, quem receberia pesável no catálogo da loja', tags: ['ADMIN', 'CREARE'],
    },
  }, backfillController.previa.bind(backfillController));

  typed.post<{ Body: { loja: 'TNP' | 'LI'; confirmacao: string; hashPlano: string; conflitos?: 'bloquear' | 'manterCadastro' } }>('/admin/creare/pesavel-backfill/aplicar', {
    preHandler: [authMiddleware],
    schema: {
      body: z.object({
        loja: z.enum(['TNP', 'LI']), confirmacao: z.string().min(1), hashPlano: z.string().regex(/^[a-f0-9]{64}$/),
        conflitos: politicaConflito,
      }),
      summary: 'Classificar pesável no catálogo da loja após prévia', tags: ['ADMIN', 'CREARE'],
    },
  }, backfillController.aplicar.bind(backfillController));
  /*
   * Padronizar pesável: TODO ativo da loja vira S, tecla 000, validade 5, e o
   * espelho SIA acompanha. Decisão do José em 06/10/2026, depois de o TXT
   * entrar no SIA com produto não pesável: "trocar tudo pra sim e depois ir
   * editando". Diferente do backfill, esta sobrescreve quem já dizia N.
   */
  const regraBarras = z.enum(['pesavel', 'naoPesavel']).optional();
  typed.get<{ Querystring: { loja: 'TNP' | 'LI'; barrasProprias?: 'pesavel' | 'naoPesavel' } }>('/admin/creare/pesavel-padronizar/previa', {
    preHandler: [authMiddleware],
    schema: {
      querystring: z.object({ loja: z.enum(['TNP', 'LI']), barrasProprias: regraBarras }),
      summary: 'Conferir, sem gravar, quantos ativos da loja ainda não são pesáveis S/000/5', tags: ['ADMIN', 'CREARE'],
    },
  }, padronizarController.previa.bind(padronizarController));

  typed.post<{ Body: { loja: 'TNP' | 'LI'; confirmacao: string; hashPlano: string; barrasProprias?: 'pesavel' | 'naoPesavel' } }>('/admin/creare/pesavel-padronizar/aplicar', {
    preHandler: [authMiddleware],
    schema: {
      body: z.object({
        loja: z.enum(['TNP', 'LI']), confirmacao: z.string().min(1), hashPlano: z.string().regex(/^[a-f0-9]{64}$/),
        barrasProprias: regraBarras,
      }),
      summary: 'Tornar todos os ativos da loja pesáveis (S, tecla 000, validade 5) após prévia', tags: ['ADMIN', 'CREARE'],
    },
  }, padronizarController.aplicar.bind(padronizarController));
}
