/**
 * Regra de meta por turno, transportada da aba `TNP - RELATORIO VENDAS ANO VS ANO (VND)`.
 *
 * A planilha monta a meta de um dia assim: pega a venda de uma referência,
 * aplica um crescimento, ARREDONDA e parte entre manhã e tarde por uma
 * porcentagem do dia da semana. Aqui a referência é a **média ponderada dos
 * últimos meses** (decisão do José em 05/10/2026), e não a venda do mesmo dia
 * da semana do ano anterior, que era o que a planilha usava.
 *
 * As porcentagens de manhã/tarde também saem do dado medido, não de uma tabela
 * digitada: a planilha tinha 45/55 para segunda quando o real ponderado era
 * 48/52, e 60/40 para sábado quando o real era 65/35.
 *
 * Nada aqui conhece banco nem HTTP: a API usa para gerar e servir, e a tela usa
 * para conferir os números na hora. Mesma regra nos dois lados.
 */

/** Crescimento sobre a referência. 15% é a decisão do José de 05/10/2026. */
export const CRESCIMENTO_PADRAO = 0.15;

/**
 * Arredondamento da meta, nas casas do `ROUND(x; -2)` da planilha: R$ 100.
 * Meta com centavos não é meta — ninguém persegue R$ 22.137,43.
 */
export const CASAS_ARREDONDAMENTO = -2;

export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const NOME_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;
export const SIGLA_DIA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'] as const;

/** Um dia já realizado, partido por turno. `data` em `aaaa-mm-dd`. */
export interface DiaRealizado {
  data: string;
  manha: number;
  tarde: number;
}

/** O que a média ponderada de um dia da semana diz. */
export interface ReferenciaDia {
  diaSemana: DiaSemana;
  /** Quantos dias desse dia da semana entraram na média. Amostra pequena é aviso na tela. */
  ocorrencias: number;
  mediaDia: number;
  /** Fração de 0 a 1. Ponderada pelo faturamento, não média das porcentagens. */
  pctManha: number;
}

export interface MetaDia extends ReferenciaDia {
  meta: number;
  metaManha: number;
  metaTarde: number;
}

export interface TotalPeriodo {
  total: number;
  manha: number;
  tarde: number;
  /** Dias do período em que a loja abre, segundo a matriz. */
  dias: number;
}

const centavos = (valor: number) => Math.round(valor * 100) / 100;

/** Dia da semana de `aaaa-mm-dd`, lido em UTC para não escorregar por fuso. */
export function diaSemanaDe(data: string): DiaSemana {
  const ms = Date.parse(`${data}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`Data inválida: ${data}`);
  return new Date(ms).getUTCDay() as DiaSemana;
}

/** Todas as datas de `inicio` a `fim`, inclusive, em `aaaa-mm-dd`. */
export function datasDe(inicio: string, fim: string): string[] {
  const i = Date.parse(`${inicio}T00:00:00Z`);
  const f = Date.parse(`${fim}T00:00:00Z`);
  if (!Number.isFinite(i) || !Number.isFinite(f)) throw new Error('Período inválido.');
  const datas: string[] = [];
  for (let ms = i; ms <= f; ms += 86_400_000) datas.push(new Date(ms).toISOString().slice(0, 10));
  return datas;
}

export function arredondarMeta(valor: number, casas = CASAS_ARREDONDAMENTO): number {
  const passo = 10 ** -casas;
  return Math.round(valor / passo) * passo;
}

/**
 * Média ponderada por dia da semana.
 *
 * PONDERADA pelo faturamento (`soma manhã ÷ soma total`), não média das
 * porcentagens diárias: um sábado forte tem de pesar mais que um sábado fraco.
 * Medido em jul–set/2026 as duas quase empatam (menos de 0,3 p.p. de diferença),
 * o que é a prova de que a participação por dia da semana é estável — e a razão
 * de a matriz ser por dia da semana e não por dia do mês.
 *
 * Dia da semana sem nenhuma ocorrência **não entra**. É assim que domingo cai
 * fora sozinho, por não haver venda, em vez de ficar uma regra "a loja fecha
 * domingo" escrita no código: se um dia a loja abrir, o dado traz o dia de volta.
 */
export function referenciaPonderada(dias: DiaRealizado[]): ReferenciaDia[] {
  const soma = new Map<DiaSemana, { total: number; manha: number; ocorrencias: number }>();
  for (const dia of dias) {
    const total = dia.manha + dia.tarde;
    if (total <= 0) continue; // dia fechado não puxa a média para baixo
    const dow = diaSemanaDe(dia.data);
    const atual = soma.get(dow) ?? { total: 0, manha: 0, ocorrencias: 0 };
    atual.total += total;
    atual.manha += dia.manha;
    atual.ocorrencias += 1;
    soma.set(dow, atual);
  }
  return [...soma.entries()]
    .map(([diaSemana, s]) => ({
      diaSemana,
      ocorrencias: s.ocorrencias,
      mediaDia: centavos(s.total / s.ocorrencias),
      pctManha: s.total > 0 ? s.manha / s.total : 0,
    }))
    .sort((a, b) => (a.diaSemana === 0 ? 7 : a.diaSemana) - (b.diaSemana === 0 ? 7 : b.diaSemana));
}

/**
 * Referência + crescimento, arredondado, partido por turno.
 *
 * `metaTarde` é o RESTO (`meta − metaManha`), não um segundo arredondamento:
 * assim manhã e tarde somam exatamente a meta do dia. Arredondar os dois lados
 * faria a soma dos cartões divergir do cartão do total, e a tela perderia a
 * confiança do operador por uma diferença de R$ 100.
 */
export function aplicarCrescimento(
  referencia: ReferenciaDia[], crescimento = CRESCIMENTO_PADRAO, casas = CASAS_ARREDONDAMENTO,
): MetaDia[] {
  return referencia.map((ref) => {
    const meta = arredondarMeta(ref.mediaDia * (1 + crescimento), casas);
    const metaManha = arredondarMeta(meta * ref.pctManha, casas);
    return { ...ref, meta, metaManha, metaTarde: centavos(meta - metaManha) };
  });
}

/** Meta somada das datas informadas. Dia fora da matriz conta zero (loja fechada). */
export function metaDoPeriodo(matriz: MetaDia[], datas: string[]): TotalPeriodo {
  const porDia = new Map<DiaSemana, MetaDia>(matriz.map((m) => [m.diaSemana, m]));
  let total = 0; let manha = 0; let tarde = 0; let dias = 0;
  for (const data of datas) {
    const meta = porDia.get(diaSemanaDe(data));
    if (!meta) continue;
    total += meta.meta; manha += meta.metaManha; tarde += meta.metaTarde; dias += 1;
  }
  return { total: centavos(total), manha: centavos(manha), tarde: centavos(tarde), dias };
}

/**
 * Quanto do esperado já saiu. `null` quando não há esperado — e `null` é
 * diferente de zero: sem dia apurado a tela não pode dizer "0% da meta".
 */
export function ritmo(realizado: number, esperado: number): number | null {
  if (esperado <= 0) return null;
  return realizado / esperado;
}

/**
 * Onde o mês fecha se o ritmo de hoje continuar. Arredondada como a meta, para
 * não sugerir precisão que uma projeção não tem.
 */
export function projecaoFechamento(
  metaDoMes: number, realizado: number, esperado: number, casas = CASAS_ARREDONDAMENTO,
): number | null {
  const r = ritmo(realizado, esperado);
  if (r === null) return null;
  return arredondarMeta(metaDoMes * r, casas);
}
