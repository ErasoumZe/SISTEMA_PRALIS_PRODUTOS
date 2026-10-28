import { z } from 'zod/v4';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use aaaa-mm-dd');
const loja = z.enum(['TNP', 'LI']);

export const metasQuerySchema = z.object({
  loja: loja.optional(),
  /** Período apurado. Sem período, a API usa o mês corrente da loja. */
  inicio: data.optional(),
  fim: data.optional(),
});

/** Uma linha da matriz: o dia da semana e a meta que ele carrega, em pontos. */
export const metaDiaSemanaSchema = z.object({
  diaSemana: z.number().int().min(0).max(6),
  sigla: z.string(),
  nome: z.string(),
  ocorrencias: z.number().int(),
  referenciaMedia: z.number(),
  pctManha: z.number(),
  meta: z.number(),
  metaManha: z.number(),
  metaTarde: z.number(),
});

/**
 * O que cada cartão mostra, **em pontos** — a unidade do Relatório Gerentes.
 *
 * `null` em ritmo e projeção = ainda não há dia apurado, que é diferente de zero.
 *
 * `reais` permanece no contrato por compatibilidade, mas a rota do Relatório
 * Gerentes sempre o devolve como `null`: essa tela exibe somente pontos.
 */
export const metaTurnoSchema = z.object({
  metaPeriodo: z.number(),
  metaAteAgora: z.number(),
  realizado: z.number(),
  diferenca: z.number(),
  ritmo: z.number().nullable(),
  projecao: z.number().nullable(),
  reais: z.object({
    metaPeriodo: z.number(),
    metaAteAgora: z.number(),
    realizado: z.number(),
    diferenca: z.number(),
    projecao: z.number().nullable(),
  }).nullable(),
});

/** Um dia do período, em pontos. */
export const metaDiaSchema = z.object({
  data: data,
  sigla: z.string(),
  aberto: z.boolean(),
  meta: z.number(),
  metaManha: z.number(),
  metaTarde: z.number(),
  realizado: z.number(),
  manha: z.number(),
  tarde: z.number(),
});

export const metasSchema = z.object({
  loja,
  periodo: z.object({ inicio: data, fim: data }),
  /** A TNP usa a planilha quando a fonte read-only foi configurada; LI mantém a matriz anterior. */
  regra: z.enum(['matriz_tres_meses', 'planilha_364_dias']),
  /** Nula quando ainda não se gerou matriz nenhuma para esta loja. */
  versao: z.object({
    id: z.string(),
    vigenciaInicio: data,
    crescimento: z.number(),
    referenciaInicio: data,
    referenciaFim: data,
    observacao: z.string().nullable(),
    criadoEm: z.string(),
  }).nullable(),
  matriz: z.array(metaDiaSemanaSchema),
  turnos: z.object({
    manha: metaTurnoSchema,
    tarde: metaTurnoSchema,
    total: metaTurnoSchema,
  }),
  dias: z.array(metaDiaSchema),
  /**
   * De onde veio o realizado e até onde ele alcança. Existe porque o robô já
   * parou antes: sem isto, um período sem fechamento aparece como meta não
   * batida, quando o que falta é dado.
   */
  fonte: z.object({
    origem: z.enum(['fechamento_caixa_dia', 'planilha_ano_vs_ano_e_fechamento_caixa_dia']),
    diasAbertos: z.number().int(),
    diasApurados: z.number().int(),
    ultimoDiaApurado: data.nullable(),
    /** Dias do período sem nenhum fechamento de caixa. */
    diasSemFechamento: z.array(data),
    /**
     * Dias com fechamento incompleto. O realizado deles vem dos itens dos
     * cupons, com o turno pela hora da venda (manhã até 14:00, tarde a partir
     * de 14:01); sem itens, ficam fora.
     */
    diasFechamentoIncompleto: z.array(data).default([]),
    /** Dias abertos sem venda histórica comparável; não entram como meta zero. */
    diasSemReferencia: z.array(data),
    planilhaLidaEm: z.string().nullable(),
  }),
});

/** Gera a matriz. `previa` calcula e devolve sem gravar. */
export const gerarMatrizBodySchema = z.object({
  loja,
  referenciaInicio: data,
  referenciaFim: data,
  /** Fração: 0,15 são os 15% decididos em 05/10/2026. */
  crescimento: z.number().min(-0.9).max(5),
  vigenciaInicio: data,
  observacao: z.string().max(240).optional(),
  previa: z.boolean().optional().default(false),
});

export const gerarMatrizResultSchema = z.object({
  gravada: z.boolean(),
  versaoId: z.string().nullable(),
  referencia: z.object({ inicio: data, fim: data, diasConsiderados: z.number().int() }),
  matriz: z.array(metaDiaSemanaSchema),
  semanaCompleta: z.object({ total: z.number(), manha: z.number(), tarde: z.number(), dias: z.number().int() }),
});

/** Importação consciente da planilha: prévia por padrão, gravação só com aplicar=true. */
export const importarMetasPlanilhaTnpBodySchema = z.object({
  vigenciaInicio: data,
  aplicar: z.boolean().optional().default(false),
});

export const importarMetasPlanilhaTnpResultSchema = z.object({
  aplicada: z.boolean(),
  vigenciaInicio: data,
  gravadas: z.number().int(),
  calculadas: z.number().int(),
  semReferencia: z.number().int(),
  domingos: z.number().int(),
  lidaEm: z.string(),
});

export type MetasQuery = z.output<typeof metasQuerySchema>;
export type Metas = z.output<typeof metasSchema>;
export type MetaDiaSemana = z.output<typeof metaDiaSemanaSchema>;
export type MetaTurno = z.output<typeof metaTurnoSchema>;
export type GerarMatrizBody = z.output<typeof gerarMatrizBodySchema>;
export type GerarMatrizResult = z.output<typeof gerarMatrizResultSchema>;
export type ImportarMetasPlanilhaTnpBody = z.output<typeof importarMetasPlanilhaTnpBodySchema>;
export type ImportarMetasPlanilhaTnpResult = z.output<typeof importarMetasPlanilhaTnpResultSchema>;
