import { z } from 'zod/v4';

/**
 * O PULSO da importação: faz quanto tempo que não chega lote do robô.
 *
 * Existe por um caso real: o robô parou em 08/09/2026 e ninguém percebeu por
 * SEIS dias. O sistema recebia o lote, gravava e não guardava nenhuma noção de
 * "faz tempo que não chega nada" — nenhuma tela mostrava, nenhum alerta
 * disparava. Relatório vazio não grita; ele só parece um dia fraco.
 */

/** Quantos dias sem lote antes de virar alerta na tela. */
export const DIAS_PARA_ALERTA = 2;

export const fonteDoPulsoSchema = z.object({
  loja: z.string(),
  /** `venda_produto_dia` ou `fechamento_caixa_dia` — uma pode parar sem a outra. */
  tipo: z.string(),
  /** O dia da VENDA mais recente que existe. `null` quando nunca chegou nada. */
  ultimoDia: z.string().nullable(),
  /** Quando a linha mais recente ENTROU no banco. */
  ultimaChegada: z.string().nullable(),
  /**
   * Dias entre o último dia de venda e hoje.
   *
   * É este o número que denuncia a parada — e não a data da chegada: o robô
   * pode estar mandando todo dia um arquivo velho, e aí `ultimaChegada` fica
   * bonita enquanto `ultimoDia` congela.
   */
  diasSemDados: z.number().nullable(),
  /** `true` quando passou de `DIAS_PARA_ALERTA`. */
  atrasado: z.boolean(),
});

export const pulsoSchema = z.object({
  /** `true` se QUALQUER fonte está atrasada — é o que a tela usa para o aviso. */
  algumAtrasado: z.boolean(),
  fontes: z.array(fonteDoPulsoSchema),
});

export type Pulso = z.output<typeof pulsoSchema>;
export type FonteDoPulso = z.output<typeof fonteDoPulsoSchema>;
