import { z } from 'zod/v4';

/** Datas/horas locais da loja, interpretadas em America/Sao_Paulo. */
const dataHoraLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const detalhePdvQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI']).optional(),
  dispositivoIdErp: z.string().min(1),
  inicio: dataHoraLocal,
  fim: dataHoraLocal,
  ordenar: z.enum(['quantidade', 'faturamento']).optional().default('quantidade'),
});

export const detalhePdvSchema = z.object({
  loja: z.enum(['TNP', 'LI']),
  dispositivoIdErp: z.string(),
  periodo: z.object({ inicio: z.string(), fim: z.string(), fuso: z.literal('America/Sao_Paulo') }),
  /** O robô ainda pode não ter enviado nenhum item deste PDV/período. */
  disponivel: z.boolean(),
  faturamentoItens: z.number().nullable(),
  quantidade: z.number(),
  numeroVendas: z.number(),
  coberturaCadastroPercentual: z.number(),
  itens: z.array(z.object({
    produtoIdErp: z.string(),
    produtoCodigo: z.string(),
    produto: z.string(),
    produtoCadastro: z.string().nullable(),
    quantidade: z.number(),
    faturamento: z.number().nullable(),
  })),
  /** Fechamento só pode ser comparado quando o período cobre dias completos. */
  fechamento: z.object({ total: z.number().nullable(), numeroVendas: z.number(), diferenca: z.number().nullable() }).nullable(),
  /**
   * Série por HORA local — a única desta área com hora de verdade, porque só
   * o detalhe do PDV tem `vendido_em`. O relatório diário nunca fabrica isto.
   * `hora` no formato `aaaa-mm-ddThh:00`.
   */
  porHora: z.array(z.object({
    hora: z.string(),
    quantidade: z.number(),
    faturamento: z.number().nullable(),
    numeroVendas: z.number(),
  })),
});

export type DetalhePdvQuery = z.output<typeof detalhePdvQuerySchema>;
export type DetalhePdv = z.output<typeof detalhePdvSchema>;
