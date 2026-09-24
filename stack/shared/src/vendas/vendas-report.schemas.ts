import { z } from 'zod/v4';

/**
 * Filtros por CADASTRO, compartilhados por relatório, ranking e curva ABC.
 *
 * Alcançam só o que sai de itens vendidos (produto x dia). Número de vendas,
 * pagamentos e ranking de PDV vêm do fechamento de caixa, que não tem itens —
 * filtrar isso por setor exigiria rateio, e rateio é número inventado.
 */
export const filtrosCadastroSchema = z.object({
  setor: z.string().trim().max(120).optional(),
  grupo: z.string().trim().max(120).optional(),
  produto: z.string().trim().max(120).optional(),
});

export const vendasReportQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI']).optional(),
  inicio: z.iso.date(),
  fim: z.iso.date(),
}).extend(filtrosCadastroSchema.shape);

/** O que o filtro de cadastro alcançou nesta resposta. */
export const filtrosAplicadosSchema = z.object({
  setor: z.string().nullable(),
  grupo: z.string().nullable(),
  produto: z.string().nullable(),
  ativo: z.boolean(),
  /** Faturamento e quantidade vêm de itens e obedecem ao filtro; o resto não. */
  alcance: z.literal('itens'),
});

const produtoRankingSchema = z.object({
  produtoCodigo: z.string(),
  produto: z.string(),
  quantidade: z.number(),
  faturamento: z.number(),
});

const pagamentoDiaSchema = z.object({
  data: z.string(),
  numeroVendas: z.number(),
  dinheiro: z.number(),
  debito: z.number(),
  credito: z.number(),
  pix: z.number(),
  voucher: z.number(),
  crediario: z.number(),
  clientes: z.number(),
  colaboradores: z.number(),
  alimentacao: z.number(),
  rouboFurto: z.number(),
  socios: z.number(),
  sobraPerda: z.number(),
  outros: z.number(),
  total: z.number(),
});

/**
 * Margem SEMPRE acompanhada da cobertura. Um lucro calculado sobre 60% do
 * faturamento, apresentado como se fosse o total, leva a decisão errada de
 * preço — numa padaria, o pão sem custo cadastrado se esconde atrás da
 * Coca-Cola. Quem lê precisa ver sobre quanto a conta foi feita.
 */
const margemSchema = z.object({
  /** Faturamento cujo produto foi encontrado no cadastro E tem custo. */
  faturamentoComCusto: z.number(),
  faturamentoSemCusto: z.number(),
  /** 0 a 100. É o número que qualifica todos os outros deste bloco. */
  coberturaPercentual: z.number(),
  /** Códigos vendidos que não casaram com nenhum produto do cadastro. */
  produtosSemVinculo: z.number(),
  custoTotal: z.number(),
  lucroBruto: z.number(),
  /** Lucro sobre o faturamento COM custo, nunca sobre o total. */
  margemPercentual: z.number(),
});

export const vendasReportSchema = z.object({
  loja: z.enum(['TNP', 'LI']),
  /**
   * `granularidade: 'dia'` é declaração, não enfeite: as duas fontes deste
   * relatório só têm DATA. Hora existe apenas no detalhe por PDV, e quando a
   * tela recebe hora aqui ela precisa saber que o servidor a ignorou.
   */
  periodo: z.object({ inicio: z.string(), fim: z.string(), granularidade: z.literal('dia') }),
  filtros: filtrosAplicadosSchema,
  resumo: z.object({
    faturamento: z.number(),
    quantidade: z.number(),
    numeroVendas: z.number(),
    totalPagamentos: z.number(),
    ticketMedio: z.number(),
  }),
  ranking: z.object({
    maisVendidos: z.array(produtoRankingSchema),
    menosVendidos: z.array(produtoRankingSchema),
  }),
  curvaAbc: z.array(z.object({
    classe: z.enum(['A', 'B', 'C']),
    produtos: z.number(),
    faturamento: z.number(),
    percentual: z.number(),
  })),
  pagamentos: z.array(pagamentoDiaSchema),
  margem: margemSchema,
  qualidade: z.object({
    produtosSemCodigo: z.number(),
    faturamentoSemCodigo: z.number(),
    outrosPagamento: z.number(),
  }),
});

export type VendasReportQuery = z.output<typeof vendasReportQuerySchema>;
export type VendasReport = z.output<typeof vendasReportSchema>;
export type ProdutoRanking = z.output<typeof produtoRankingSchema>;
export type PagamentoDia = z.output<typeof pagamentoDiaSchema>;
export type Margem = z.output<typeof margemSchema>;

