import { z } from 'zod/v4';

/**
 * Ranking de vendas por DIMENSÃO — produto, grupo, setor ou PDV.
 *
 * Uma porta só para as quatro perguntas porque a conta é a mesma: somar
 * faturamento por uma chave e ordenar. O que muda é de onde a chave sai, e
 * isso é dito no `campo` de cada resposta — nunca implícito.
 */

export const DIMENSOES = ['produto', 'grupo', 'setor', 'pdv'] as const;
export type Dimensao = (typeof DIMENSOES)[number];

export const vendasRankingQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI']).optional(),
  inicio: z.iso.date(),
  fim: z.iso.date(),
  dimensao: z.enum(DIMENSOES),
  /**
   * De qual campo do cadastro sai o "setor". Só vale com `dimensao=setor`.
   *
   * `setorEstoque` é o padrão porque é o único preenchido hoje — e, apesar do
   * nome, é ele que guarda `PROD. - PANIFICAÇÃO`, `PROD. - CONFEITARIA`,
   * `LJ - CAIXAS`. O campo desenhado para isto (`setorVenda1`) está vazio em
   * 100% do cadastro; no dia em que for preenchido, é trocar aqui.
   */
  campoSetor: z.enum(['setorEstoque', 'setorVenda1']).optional(),
  // mesmos filtros do relatório; só valem para produto/grupo/setor — PDV não tem itens
  setor: z.string().trim().max(120).optional(),
  grupo: z.string().trim().max(120).optional(),
  produto: z.string().trim().max(120).optional(),
  hi: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  hf: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  pdv: z.string().trim().max(60).optional(),
});

/**
 * Pontos por real faturado, para o ranking de bonificação.
 *
 * Mora no schema — e não na tela — porque é REGRA, não formatação: a mesma
 * conta precisa valer para quem vê o painel, para quem confere o valor e para
 * qualquer relatório futuro. Um número desses espalhado em dois lugares vira
 * duas verdades no dia em que alguém mudar um só.
 */
export const PONTOS_POR_REAL = 0.25;

export const itemRankingSchema = z.object({
  /** Identidade estável — é por ela que a animação sabe quem subiu e quem desceu. */
  chave: z.string(),
  rotulo: z.string(),
  /**
   * `null` para quem não pode ver dinheiro.
   *
   * Nulo no SERVIDOR, não escondido na tela: o painel de setores fica num
   * monitor visto por colaboradores, e esconder a coluna no HTML deixaria o
   * número viajando na resposta — qualquer um abre o navegador e lê. Quem não
   * pode ver não recebe.
   */
  faturamento: z.number().nullable(),
  /** Unidades vendidas. `null` em PDV: o fechamento conta vendas, não itens. */
  quantidade: z.number().nullable(),
  /** Nº de vendas (tickets). Só o PDV tem; nas demais dimensões é `null`. */
  numeroVendas: z.number().nullable(),
  /** Fatia do faturamento do período, 0 a 100. */
  participacao: z.number(),
  /** `faturamento * PONTOS_POR_REAL`, arredondado em centavos. */
  pontos: z.number(),
  /** Posição, 1 é o primeiro. Vem pronta para a tela não recalcular. */
  posicao: z.number(),
});

/**
 * Quanto do faturamento conseguiu ser classificado nesta dimensão.
 *
 * Existe pelo mesmo motivo da cobertura da margem: um ranking de setor montado
 * sobre 40% do faturamento, apresentado como se fosse o todo, premia o setor
 * errado. Quem lê precisa ver sobre quanto a conta foi feita.
 */
export const coberturaSchema = z.object({
  /** `null` para quem não pode ver dinheiro — mesma regra do item. */
  faturamentoClassificado: z.number().nullable(),
  faturamentoSemClassificacao: z.number().nullable(),
  /** 0 a 100. É o número que qualifica o ranking inteiro. */
  percentual: z.number(),
  /** Quantas linhas de venda não casaram com produto do cadastro. */
  linhasSemVinculo: z.number(),
});

export const vendasRankingSchema = z.object({
  loja: z.enum(['TNP', 'LI']),
  periodo: z.object({ inicio: z.string(), fim: z.string() }),
  dimensao: z.enum(DIMENSOES),
  /** O campo do cadastro que virou a chave. `null` quando não se aplica. */
  campo: z.string().nullable(),
  /** `null` para quem não pode ver dinheiro. */
  faturamentoTotal: z.number().nullable(),
  pontosTotal: z.number(),
  itens: z.array(itemRankingSchema),
  cobertura: coberturaSchema,
});

export type VendasRankingQuery = z.output<typeof vendasRankingQuerySchema>;
export type VendasRanking = z.output<typeof vendasRankingSchema>;
export type ItemRanking = z.output<typeof itemRankingSchema>;
