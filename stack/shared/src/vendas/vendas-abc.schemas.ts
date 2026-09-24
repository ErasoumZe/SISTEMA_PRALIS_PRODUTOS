import { z } from 'zod/v4';

/**
 * A lista dos produtos de uma classe da curva ABC — em especial a classe A,
 * que é a resposta para "o que não pode faltar na prateleira".
 *
 * Não é o resumo da curva (esse já existe no relatório): é produto a produto,
 * com o que se sabe do cadastro ao lado do que ele vendeu.
 */

export const abcProdutosQuerySchema = z.object({
  loja: z.enum(['BASE', 'TNP', 'LI']).optional(),
  inicio: z.iso.date(),
  fim: z.iso.date(),
  classe: z.enum(['A', 'B', 'C']).optional(),
  setor: z.string().trim().max(120).optional(),
  grupo: z.string().trim().max(120).optional(),
  produto: z.string().trim().max(120).optional(),
});

export const produtoAbcSchema = z.object({
  classe: z.enum(['A', 'B', 'C']),
  posicao: z.number(),
  produtoCodigo: z.string(),
  produto: z.string(),
  quantidade: z.number(),
  faturamento: z.number(),
  /** Fatia do faturamento do período, 0 a 100. */
  participacao: z.number(),
  /** Soma acumulada até aqui, 0 a 100. É ela que define a classe. */
  acumulado: z.number(),
  /**
   * Unidades por dia no período. É o sinal de reposição que dá para calcular
   * hoje: quanto mais rápido gira, menos tempo o estoque dura.
   */
  porDia: z.number(),

  /* ---- o que vem do CADASTRO. Tudo `null` quando a venda não casou. ---- */
  productId: z.string().nullable(),
  grupo: z.string().nullable(),
  setor: z.string().nullable(),
  custo: z.number().nullable(),
  estoqueMin: z.number().nullable(),
  estoqueMax: z.number().nullable(),
  /**
   * Em quantos dias a venda do período consumiria o estoque MÁXIMO cadastrado.
   *
   * NÃO é "quanto tempo o estoque de hoje dura" — isso exigiria saber o saldo
   * atual, que o sistema não tem. É o teto: mesmo com a prateleira cheia, o
   * produto acaba em tantos dias nesse ritmo. `null` quando falta o máximo
   * cadastrado ou quando o produto não vendeu.
   */
  diasDeMaximo: z.number().nullable(),
});

export const abcProdutosSchema = z.object({
  loja: z.enum(['BASE', 'TNP', 'LI']),
  periodo: z.object({ inicio: z.string(), fim: z.string(), dias: z.number() }),
  faturamentoTotal: z.number(),
  itens: z.array(produtoAbcSchema),
  /**
   * Quantos itens da lista NÃO casaram com o cadastro.
   *
   * Importa aqui mais que em qualquer outra tela: um produto classe A sem
   * vínculo é um produto que sustenta o faturamento e sobre o qual não se sabe
   * custo, mínimo nem máximo. É o pior lugar do catálogo para ter um buraco.
   */
  semCadastro: z.number(),
  /** Quantos, entre os que casaram, estão sem estoque máximo cadastrado. */
  semEstoqueMax: z.number(),
});

export type AbcProdutosQuery = z.output<typeof abcProdutosQuerySchema>;
export type AbcProdutos = z.output<typeof abcProdutosSchema>;
export type ProdutoAbc = z.output<typeof produtoAbcSchema>;
