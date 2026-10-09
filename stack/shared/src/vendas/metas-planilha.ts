/**
 * Regra diária da TNP auditada na aba "TNP - RELATORIO VENDAS ANO VS ANO (VND)".
 * Não lê Google Sheets, banco ou relógio: entradas têm procedência externa.
 * Separar o cálculo da ingestão permite comparar cada data com CQ/DL/EG antes
 * de substituir a matriz antiga em produção.
 */

export type ModoMetaPlanilha = 'ajustada' | 'crescida' | 'arredondada';

export interface ParametrosMetaPlanilha {
  /** Ajuste manual BA; 0 quando a célula está vazia. */
  ajusteDia: number;
  /** Crescimento BB; 0 quando o mês cadastrado está em 0%. */
  crescimentoMes: number;
  /** Percentual AF, já resolvido da tabela semanal/feriado/exceção manual. */
  pctManha: number;
  /** Modo de CN5; atualmente 'arredondada'. */
  modo: ModoMetaPlanilha;
  /** CT8; atualmente -2. */
  casasArredondamento: number;
}

export interface ResultadoMetaPlanilha {
  base: number;
  ajustada: number;
  crescida: number;
  total: number;
  manha: number;
  /** Decisão de José: tarde é o restante para os três cards fecharem. */
  tarde: number;
  /** EG da planilha, para auditoria da diferença por arredondamento. */
  tardePlanilha: number;
  diferencaTardePlanilha: number;
}

export type MetaTnpDia =
  | { estado: 'domingo_fechado'; data: string; total: 0; manha: 0; tarde: 0 }
  | { estado: 'sem_referencia'; data: string; dataBase: string }
  | { estado: 'calculada'; data: string; dataBase: string; valores: ResultadoMetaPlanilha };

const centavos = (valor: number): number => Math.round((valor + Number.EPSILON) * 100) / 100;

/** ROUND do Sheets: empate aumenta o módulo, diferente de empate-para-par. */
export function arredondarComoSheets(valor: number, casas: number): number {
  if (!Number.isFinite(valor) || !Number.isInteger(casas) || casas < -3 || casas > 3) {
    throw new Error('Valor ou casas de arredondamento inválidos.');
  }
  const passo = 10 ** -casas;
  const resultado = Math.sign(valor) * Math.round((Math.abs(valor) + Number.EPSILON * passo) / passo) * passo;
  return Object.is(resultado, -0) ? 0 : resultado;
}

/** Data civil, em UTC apenas para não sofrer deslocamento de fuso. */
export function dataBase364DiasAntes(data: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data deve estar em aaaa-mm-dd.');
  const instante = Date.parse(`${data}T00:00:00Z`);
  if (!Number.isFinite(instante) || new Date(instante).toISOString().slice(0, 10) !== data) {
    throw new Error('Data civil inválida.');
  }
  return new Date(instante - 364 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Preserva CQ e DL da planilha. A tarde é total - manhã para fechar os cards,
 * como José decidiu em 09/10/2026; EG original é devolvido para conciliação.
 * Falta de faturamento-base não entra aqui: o chamador deve marcar sem referência.
 */
export function calcularMetaPlanilha(base: number, parametros: ParametrosMetaPlanilha): ResultadoMetaPlanilha {
  const { ajusteDia, crescimentoMes, pctManha, modo, casasArredondamento } = parametros;
  if (![base, ajusteDia, crescimentoMes, pctManha].every(Number.isFinite)
    || base < 0 || pctManha < 0 || pctManha > 1
    || ajusteDia < -1 || crescimentoMes < -1) {
    throw new Error('Parâmetros da meta inválidos.');
  }
  const ajustada = base * (1 + ajusteDia);
  const crescida = ajustada * (1 + crescimentoMes);
  const etapa = modo === 'ajustada' ? ajustada : modo === 'crescida' ? crescida : modo === 'arredondada' ? crescida : NaN;
  if (!Number.isFinite(etapa)) throw new Error('Modo de meta inválido.');

  const total = modo === 'arredondada' ? arredondarComoSheets(etapa, casasArredondamento) : centavos(etapa);
  const manhaBruta = etapa * pctManha;
  const manha = modo === 'arredondada' ? arredondarComoSheets(manhaBruta, casasArredondamento) : centavos(manhaBruta);
  // AQ da aba é 0 quando AF=0. Isso só representa corretamente dia fechado;
  // domingo com base positiva deve ser tratado como exceção na importação.
  const pctTardePlanilha = pctManha === 0 ? 0 : 1 - pctManha;
  const tardePlanilhaBruta = etapa * pctTardePlanilha;
  const tardePlanilha = modo === 'arredondada'
    ? arredondarComoSheets(tardePlanilhaBruta, casasArredondamento)
    : centavos(tardePlanilhaBruta);
  const tarde = centavos(total - manha);
  return {
    base, ajustada: centavos(ajustada), crescida: centavos(crescida),
    total, manha, tarde, tardePlanilha, diferencaTardePlanilha: centavos(tarde - tardePlanilha),
  };
}

/** Domingo fechado é regra operacional confirmada por José em 09/10/2026. */
export function calcularMetaTnpDia(
  data: string, base: number | null, parametros: ParametrosMetaPlanilha,
): MetaTnpDia {
  const dataBase = dataBase364DiasAntes(data);
  if (new Date(`${data}T00:00:00Z`).getUTCDay() === 0) {
    return { estado: 'domingo_fechado', data, total: 0, manha: 0, tarde: 0 };
  }
  if (base === null) return { estado: 'sem_referencia', data, dataBase };
  return { estado: 'calculada', data, dataBase, valores: calcularMetaPlanilha(base, parametros) };
}
