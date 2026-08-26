import { z } from 'zod/v4';

export const vendasReportQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI']).optional(),
  inicio: z.iso.date(),
  fim: z.iso.date(),
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

export const vendasReportSchema = z.object({
  loja: z.enum(['TNP', 'LI']),
  periodo: z.object({ inicio: z.string(), fim: z.string() }),
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

