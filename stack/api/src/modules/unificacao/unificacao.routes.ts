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
  /*
   * `z.coerce.boolean()` como no resto do sistema: qualquer texto vira `true`.
   * Por isso a tela OMITE o parâmetro quando o recorte está desligado, em vez
   * de mandar `somenteVendidos=false` — que ligaria o filtro sem querer.
   */
  somenteVendidos: z.coerce.boolean().optional(),
  q: z.string().optional(),
  decisao: z.enum(['pendente', 'feita']).optional(),
  pagina: z.coerce.number().int().positive().optional(),
  tamanho: z.coerce.number().int().positive().max(200).optional(),
});

/**
 * O cabeçalho da Central sai daqui. Aceita só o recorte dos vendidos: os demais
 * filtros são de navegação e não podem mexer no total de referência.
 */
const healthQuerySchema = z.object({
  somenteVendidos: z.coerce.boolean().optional(),
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

  // ---- ações: escrevem no catálogo mestre, uma por clique humano ----
  typed.post<{ Params: { id: string }; Body: { forcar?: boolean } }>(
    '/admin/unificacao/grupos/:id/unificar',
    {
      schema: {
        params: z.object({ id: z.string().min(1) }),
        body: z.object({ forcar: z.boolean().optional() }).optional(),
        summary: 'Criar o produto BASE do grupo e as cópias das lojas presentes (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.unificar.bind(controller),
  );

  typed.post<{ Params: { id: string }; Body: { acao: 'nao_e_o_mesmo' | 'ignorado' } }>(
    '/admin/unificacao/grupos/:id/marcar',
    {
      schema: {
        params: z.object({ id: z.string().min(1) }),
        body: z.object({ acao: z.enum(['nao_e_o_mesmo', 'ignorado']) }),
        summary: 'Tirar o grupo da fila sem criar nada (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.marcar.bind(controller),
  );

  typed.post<{ Params: { id: string } }>(
    '/admin/unificacao/grupos/:id/reabrir',
    {
      schema: {
        params: z.object({ id: z.string().min(1) }),
        summary: 'Devolver o grupo para a fila (não apaga produto já criado)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.reabrir.bind(controller),
  );

  typed.patch<{ Params: { id: string }; Body: { grupo: string } }>(
    '/admin/unificacao/grupos/:id/grupo',
    {
      schema: {
        params: z.object({ id: z.string().min(1) }),
        body: z.object({ grupo: z.string().trim().min(1).max(200) }),
        summary: 'Definir grupo oficial para item sem grupo (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.definirGrupo.bind(controller),
  );

  typed.get(
    '/admin/unificacao/auto-unificar/pendentes',
    {
      schema: {
        summary: 'Quantos grupos ainda cabem no lote automático (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.pendentesAutomaticos.bind(controller),
  );

  typed.post<{ Body: { limite?: number } }>(
    '/admin/unificacao/auto-unificar',
    {
      schema: {
        // teto de 200 por chamada: cada unificação escreve na planilha, e um
        // lote maior estoura o tempo da requisição e a cota do Google. A tela
        // repete a chamada até acabar.
        body: z.object({ limite: z.number().int().min(1).max(200).optional() }).optional(),
        summary: 'Unificar lote de correspondências fortes e sem alertas (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.unificarAutomaticos.bind(controller),
  );

  typed.get<{ Querystring: z.infer<typeof healthQuerySchema> }>(
    '/admin/unificacao/health',
    {
      schema: {
        querystring: healthQuerySchema,
        summary: 'Contagem por fonte e totais dos grupos (admin)',
        tags: ['ADMIN', 'UNIFICACAO'],
      },
    },
    controller.health.bind(controller),
  );
}
