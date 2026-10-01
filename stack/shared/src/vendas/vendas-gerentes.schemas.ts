import { z } from 'zod/v4';

export const gerentesQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI']).optional(),
  inicio: z.iso.date(),
  fim: z.iso.date(),
  pdv: z.string().trim().min(1).max(80).optional(),
});

export const gerentesSchema = z.object({
  loja: z.enum(['TNP', 'LI']),
  periodo: z.object({ inicio: z.iso.date(), fim: z.iso.date() }),
  granularidade: z.literal('dia'),
  origem: z.literal('fechamento_caixa_dia'),
  pdvs: z.array(z.string()),
  filtroPdv: z.string().nullable(),
  totalPontos: z.number(),
  series: z.array(z.object({
    pdv: z.string(),
    pontosTotal: z.number(),
    dias: z.array(z.object({ data: z.iso.date(), pontos: z.number().nullable() })),
  })),
});

export type GerentesQuery = z.infer<typeof gerentesQuerySchema>;
export type Gerentes = z.infer<typeof gerentesSchema>;
