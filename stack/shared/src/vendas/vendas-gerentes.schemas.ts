import { z } from 'zod/v4';

/** Áreas físicas agrupadas pela cor da planta da Unidade Catedral (TNP). */
export const AREAS_TNP = [
  'caixa', 'vitrine', 'copa', 'chapa', 'mesas', 'vasca_paes', 'vitrine_paes',
  'paes_empacotados', 'mesa_paes', 'frios', 'bebidas', 'laticinios', 'mercearia',
  'estoque_bebidas', 'biscoitos', 'dml_limpeza',
] as const;
export const areaTnpSchema = z.enum(AREAS_TNP);
export type AreaTnp = z.infer<typeof areaTnpSchema>;
export const NOMES_AREAS_TNP: Record<AreaTnp, string> = {
  caixa: 'Caixa', vitrine: 'Vitrine', copa: 'Copa', chapa: 'Chapa', mesas: 'Mesas',
  vasca_paes: 'Vasca pães', vitrine_paes: 'Vitrine pães', paes_empacotados: 'Pães empacotados',
  mesa_paes: 'Mesa pães', frios: 'Frios',
  bebidas: 'Bebidas', laticinios: 'Laticínios', mercearia: 'Mercearia',
  estoque_bebidas: 'Estoque de bebidas', biscoitos: 'Biscoitos', dml_limpeza: 'DML / Limpeza',
};

export const gerentesQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI']).optional(),
  inicio: z.iso.date(),
  fim: z.iso.date(),
  pdv: z.string().trim().min(1).max(80).optional(),
});

export const gerentesAcessoSchema = z.object({ lojas: z.array(z.enum(['TNP', 'LI'])) });

export const gerentesAreasQuerySchema = z.object({
  loja: z.literal('TNP'),
  inicio: z.iso.date(),
  fim: z.iso.date(),
  granularidade: z.enum(['hora', 'dia']),
});

const pontoAreaSchema = z.object({
  chave: z.string(), pontos: z.number(), faturamento: z.number().nullable(),
  quantidade: z.number(), numeroVendas: z.number().nullable(), ticketMedio: z.number().nullable(),
});
export const gerentesAreasSchema = z.object({
  loja: z.literal('TNP'), periodo: z.object({ inicio: z.iso.date(), fim: z.iso.date() }),
  granularidade: z.enum(['hora', 'dia']), origem: z.enum(['venda_item_pdv', 'venda_produto_dia']),
  categorias: z.array(z.string()),
  totalPontos: z.number(), pontosSemArea: z.number(), pontosForaHorario: z.number(),
  produtosSemVinculo: z.number(), produtosSemArea: z.number(),
  produtosAreaSugerida: z.number(), pontosAreaSugerida: z.number(),
  series: z.array(z.object({ area: areaTnpSchema, pontosTotal: z.number(), pontos: z.array(pontoAreaSchema) })),
});
export type GerentesAreasQuery = z.infer<typeof gerentesAreasQuerySchema>;
export type GerentesAreas = z.infer<typeof gerentesAreasSchema>;

export const gerentesHorasQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI']).optional(), data: z.iso.date(),
  pdv: z.string().trim().min(1).max(80).optional(),
});
export const gerentesHorasSchema = z.object({
  loja: z.enum(['TNP', 'LI']), data: z.iso.date(), origem: z.literal('venda_item_pdv'),
  horas: z.array(z.string()), pdvs: z.array(z.string()), filtroPdv: z.string().nullable(),
  totalPontos: z.number(), pontosForaHorario: z.number(),
  series: z.array(z.object({
    pdv: z.string(), pontosTotal: z.number(),
    horas: z.array(z.object({
      hora: z.string(), pontos: z.number(), faturamento: z.number().nullable(),
      quantidade: z.number(), numeroVendas: z.number(), ticketMedio: z.number().nullable(),
    })),
  })),
});
export type GerentesHorasQuery = z.infer<typeof gerentesHorasQuerySchema>;
export type GerentesHoras = z.infer<typeof gerentesHorasSchema>;

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
    dias: z.array(z.object({
      data: z.iso.date(),
      pontos: z.number().nullable(),
      /** Total do fechamento, visivel apenas para quem ja pode ver dinheiro. */
      faturamento: z.number().nullable(),
      numeroVendas: z.number().nullable(),
      ticketMedio: z.number().nullable(),
      /** Apenas itens ligados ao dispositivo pela chave do ERP; null = sem cobertura. */
      quantidade: z.number().nullable(),
      vendasComItens: z.number().nullable(),
    })),
  })),
});

export type GerentesQuery = z.infer<typeof gerentesQuerySchema>;
export type Gerentes = z.infer<typeof gerentesSchema>;
