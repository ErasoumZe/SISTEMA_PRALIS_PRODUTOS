/**
 * Quanto vale um real em pontos — a régua do placar.
 *
 * Até 06/10/2026 isto era a constante `PONTOS_POR_REAL = 0.25`, no código.
 * Mudar exigia deploy, e a régua é decisão de negócio: quem define é quem
 * cobra a meta, não quem escreve o sistema.
 *
 * TRÊS DECISÕES DO JOSÉ, em 06/10/2026:
 *
 * 1. UMA RÉGUA SÓ para faturamento e meta. Se a meta usasse outra, "quanto
 *    falta para a meta" compararia coisas medidas em unidades diferentes e
 *    nunca fecharia. O ticket médio tem campo PRÓPRIO porque ainda está em
 *    discussão se ele deve aparecer em reais ou em pontos — fica pronto e
 *    desligado até o Rodrigo decidir.
 *
 * 2. VALE A PARTIR DE UMA DATA, como a matriz de metas. Sem vigência, trocar
 *    o fator reescreveria todo o histórico: o dia que você anotou como 2.284
 *    pontos viraria outro número, e "batemos a meta em outubro" deixaria de
 *    ser verificável.
 *
 * 3. UM POR LOJA. TNP e LI podem ter réguas diferentes.
 *
 * O QUE A RÉGUA DE UM RELATÓRIO É: a vigente no PRIMEIRO DIA do período
 * consultado. É a mesma regra que a matriz de metas já usa, e por ela os
 * números de um relatório são todos da mesma régua — um período que atravessa
 * a troca sai inteiro na régua antiga. Converter dia a dia dentro do mesmo
 * relatório faria a soma dos dias não bater com o total, que é pior.
 */

export type LojaFator = 'TNP' | 'LI';

/** O que existia no código antes desta tela, e o que vale sem nada cadastrado. */
export const FATOR_PADRAO = 0.25;

/** Limites de sanidade. Zero zeraria o placar inteiro sem aviso. */
export const FATOR_MINIMO = 0.000001;
export const FATOR_MAXIMO = 1000;
export const CASAS_DO_FATOR = 6;

export interface FatorPontos {
  loja: LojaFator;
  /** A partir de quando vale. A vigente é a de maior data <= o dia consultado. */
  vigenciaInicio: string;
  /** Pontos por real. Vale para faturamento E para meta. */
  faturamento: number;
  /** Pontos por real do ticket médio. Só é usado quando `ticketEmPontos`. */
  ticketMedio: number;
  /** Desligado por padrão: hoje o ticket médio aparece em reais. */
  ticketEmPontos: boolean;
  observacao: string | null;
}

/** A régua que vale nessa data, ou `null` se nenhuma versão começou até ela. */
export function vigenteEm(
  versoes: ReadonlyArray<FatorPontos>,
  data: string,
): FatorPontos | null {
  let escolhida: FatorPontos | null = null;
  for (const v of versoes) {
    if (v.vigenciaInicio > data) continue;
    if (!escolhida || v.vigenciaInicio > escolhida.vigenciaInicio) escolhida = v;
  }
  return escolhida;
}

/**
 * O fator de faturamento que vale nessa data, com o padrão como piso.
 *
 * Devolver o padrão em vez de `null` é de propósito: um relatório sem régua
 * cadastrada precisa mostrar número, e o número certo é o que o sistema já
 * mostrava antes desta tela existir.
 */
export function fatorFaturamentoEm(versoes: ReadonlyArray<FatorPontos>, data: string): number {
  return vigenteEm(versoes, data)?.faturamento ?? FATOR_PADRAO;
}

/** Reais → pontos, em centavos de ponto. */
export function emPontos(reais: number, fator: number): number {
  const n = Number(reais);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * fator * 100) / 100;
}

/**
 * Por que um fator foi recusado, ou `null` se serve.
 *
 * A mensagem é a que a tela mostra: quem digita precisa saber o que corrigir,
 * não que "o valor é inválido".
 */
export function erroDoFator(valor: unknown): string | null {
  /*
   * Campo vazio é "não preencheu", não é zero. `Number(null)` e `Number('')`
   * dão 0 em JavaScript, e sem esta guarda a tela diria "o fator precisa ser
   * maior que zero" para quem simplesmente não digitou nada.
   */
  if (valor === null || valor === undefined || String(valor).trim() === '') return 'Informe um número.';
  const n = Number(valor);
  if (!Number.isFinite(n)) return 'Informe um número.';
  if (n <= 0) return 'O fator precisa ser maior que zero: zero zeraria toda a pontuação.';
  if (n < FATOR_MINIMO) return `O menor fator aceito é ${FATOR_MINIMO}.`;
  if (n > FATOR_MAXIMO) return `O maior fator aceito é ${FATOR_MAXIMO}.`;
  const casas = (String(n).split('.')[1] ?? '').length;
  if (casas > CASAS_DO_FATOR) return `Use no máximo ${CASAS_DO_FATOR} casas decimais.`;
  return null;
}

/**
 * O exemplo que a tela mostra ao lado do campo.
 *
 * Fator solto não diz nada a quem opera: "0,25" só vira informação como
 * "R$ 1.000,00 valem 250 pontos".
 */
export function exemploDoFator(fator: number, reais = 1000): { reais: number; pontos: number } {
  return { reais, pontos: emPontos(reais, fator) };
}
