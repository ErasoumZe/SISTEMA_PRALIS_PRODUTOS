import { z } from 'zod/v4';

/**
 * Lista de produtos ÚNICOS vendidos num período: uma linha por produto, não
 * uma por dia. É o "Remover duplicatas" do Excel aplicado às vendas.
 *
 * O agrupamento usa o `produto_id_erp` (identidade real no Creare) e cai no par
 * (código, nome) quando ele falta — as linhas anteriores a 31/08/2026 não o
 * têm. Por isso a resposta declara `linhasSemIdErp`: é o aviso honesto de que
 * aquele pedaço do período ainda pode repetir o mesmo produto sob nomes
 * diferentes.
 */

export const lojaComVendas = z.enum(['TNP', 'LI']);
export const ordenarPor = z.enum(['faturamento', 'quantidade', 'nome']);

export const produtoUnicoSchema = z.object({
  codigo: z.string(),
  produto: z.string(),
  quantidade: z.number(),
  faturamento: z.number(),
  diasComVenda: z.number(),
  primeiraVenda: z.string(),
  ultimaVenda: z.string(),
  /** > 1 significa que o produto foi renomeado no PDV durante o período. */
  nomesDiferentes: z.number(),
});

export const produtosUnicosSchema = z.object({
  loja: lojaComVendas,
  periodo: z.object({ inicio: z.string(), fim: z.string() }),
  /** Total de produtos distintos no período (não o tamanho da página). */
  total: z.number(),
  pagina: z.number(),
  porPagina: z.number(),
  totalQuantidade: z.number(),
  totalFaturamento: z.number(),
  /** Linhas de venda do período sem `produto_id_erp` — podem repetir. */
  linhasSemIdErp: z.number(),
  produtos: z.array(produtoUnicoSchema),
});

export const produtosUnicosQuerySchema = z.object({
  loja: lojaComVendas.optional(),
  inicio: z.iso.date(),
  fim: z.iso.date(),
  busca: z.string().trim().optional(),
  ordenar: ordenarPor.default('faturamento'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
});

/** O CSV sai com o período INTEIRO, não só a página aberta na tela. */
export const produtosUnicosCsvQuerySchema = z.object({
  loja: lojaComVendas.optional(),
  inicio: z.iso.date(),
  fim: z.iso.date(),
  busca: z.string().trim().optional(),
  ordenar: ordenarPor.default('faturamento'),
});

export type ProdutoUnico = z.output<typeof produtoUnicoSchema>;
export type ProdutosUnicos = z.output<typeof produtosUnicosSchema>;
export type ProdutosUnicosQuery = z.output<typeof produtosUnicosQuerySchema>;
export type ProdutosUnicosCsvQuery = z.output<typeof produtosUnicosCsvQuerySchema>;
export type OrdenarPor = z.output<typeof ordenarPor>;
