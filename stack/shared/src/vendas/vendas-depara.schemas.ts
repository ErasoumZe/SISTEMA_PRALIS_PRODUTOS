import { z } from 'zod/v4';

/**
 * De-para entre o código que o PDV manda e o produto do cadastro Pralis.
 *
 * A maioria dos códigos casa sozinha por `barcodeCandidates` (EAN ou PLU de
 * balança). Esta tabela existe para a EXCEÇÃO — o que não casa. Um vínculo só
 * entra aqui depois de uma pessoa confirmar: sugestão automática por
 * semelhança de nome nunca vira vínculo sozinha, porque errar aqui significa
 * calcular margem com o custo do produto errado.
 */

export const lojaComVendas = z.enum(['TNP', 'LI']);

/** Candidato sugerido por semelhança de nome. Sugestão, não vínculo. */
export const sugestaoSchema = z.object({
  productId: z.string(),
  nome: z.string(),
  /** Descrição montada pela regra do Pralis (nome + quantidade + medida). */
  descricao: z.string(),
  codigoBarras: z.string().nullable(),
  custo: z.number().nullable(),
  /** 0 a 100 — quanto o nome do PDV se parece com o do cadastro. */
  semelhanca: z.number(),
});

/** Um código vendido que ainda não tem produto correspondente. */
export const pendenteSchema = z.object({
  produtoCodigo: z.string(),
  produto: z.string(),
  quantidade: z.number(),
  /** Ordena a fila: resolver primeiro o que mais pesa no faturamento. */
  faturamento: z.number(),
  sugestoes: z.array(sugestaoSchema),
});

export const deParaListaSchema = z.object({
  loja: lojaComVendas,
  periodo: z.object({ inicio: z.string(), fim: z.string() }),
  /** Quanto do faturamento do período está sem vínculo. */
  faturamentoPendente: z.number(),
  pendentes: z.array(pendenteSchema),
});

export const deParaQuerySchema = z.object({
  loja: lojaComVendas.optional(),
  inicio: z.iso.date(),
  fim: z.iso.date(),
});

export const vincularBodySchema = z.object({
  loja: lojaComVendas,
  /** Pode ser vazio: o PDV manda pesável sem código. */
  produtoCodigo: z.string(),
  /** Identifica a venda quando o código vem vazio. */
  produto: z.string().min(1),
  /** `null` desfaz o vínculo. */
  productId: z.string().min(1).nullable(),
});

export type Sugestao = z.output<typeof sugestaoSchema>;
export type Pendente = z.output<typeof pendenteSchema>;
export type DeParaLista = z.output<typeof deParaListaSchema>;
export type DeParaQuery = z.output<typeof deParaQuerySchema>;
export type VincularBody = z.output<typeof vincularBodySchema>;
