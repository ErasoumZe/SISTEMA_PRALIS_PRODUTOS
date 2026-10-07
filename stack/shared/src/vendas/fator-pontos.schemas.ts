import { z } from 'zod/v4';
import { CASAS_DO_FATOR, FATOR_MAXIMO, FATOR_MINIMO } from './fator-pontos';

/**
 * Contrato da régua de pontos. Ver `fator-pontos.ts` para o porquê de cada
 * decisão; aqui só a forma do que entra e sai.
 */

const loja = z.enum(['TNP', 'LI']);

/** O mesmo limite da regra pura, para o 422 vir antes de tocar no banco. */
const fator = z.number()
  .min(FATOR_MINIMO, `O menor fator aceito é ${FATOR_MINIMO}.`)
  .max(FATOR_MAXIMO, `O maior fator aceito é ${FATOR_MAXIMO}.`)
  .refine(
    (v) => (String(v).split('.')[1] ?? '').length <= CASAS_DO_FATOR,
    `Use no máximo ${CASAS_DO_FATOR} casas decimais.`,
  );

export const fatorVersaoSchema = z.object({
  id: z.string(),
  loja,
  vigenciaInicio: z.iso.date(),
  faturamento: z.number(),
  ticketMedio: z.number(),
  ticketEmPontos: z.boolean(),
  observacao: z.string().nullable(),
  criadoPor: z.string().nullable(),
  criadoEm: z.string(),
});

export const fatorPontosQuerySchema = z.object({
  loja: loja.optional(),
});

export const fatorPontosSchema = z.object({
  loja,
  /** Todas as versões da loja, da mais recente para a mais antiga. */
  versoes: z.array(fatorVersaoSchema),
  /**
   * A que vale HOJE. `null` quando nenhuma versão começou ainda — e aí o
   * sistema usa o padrão, que vem em `padrao`.
   */
  vigenteHoje: fatorVersaoSchema.nullable(),
  /** O fator que o código usava antes desta tela existir. */
  padrao: z.number(),
  /** Onde a régua é aplicada hoje, para a tela dizer o que vai mudar. */
  ondeSeAplica: z.array(z.string()),
});

export const salvarFatorBodySchema = z.object({
  loja,
  vigenciaInicio: z.iso.date(),
  /** Vale para faturamento E para meta: a mesma régua, de propósito. */
  faturamento: fator,
  /** Pronto para uso; só vale quando `ticketEmPontos` for ligado. */
  ticketMedio: fator,
  ticketEmPontos: z.boolean().default(false),
  observacao: z.string().trim().max(400).optional(),
});

export const apagarFatorParamsSchema = z.object({ id: z.string().min(1) });

export type FatorVersao = z.output<typeof fatorVersaoSchema>;
export type FatorPontosResposta = z.output<typeof fatorPontosSchema>;
export type FatorPontosQuery = z.output<typeof fatorPontosQuerySchema>;
export type SalvarFatorBody = z.output<typeof salvarFatorBodySchema>;
