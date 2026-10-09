import { google } from 'googleapis';
import { env } from '@/config/env';
import {
  calcularMetaTnpDia, dataBase364DiasAntes,
  type MetaTnpDia, type ModoMetaPlanilha, type ParametrosMetaPlanilha,
} from '../../../../shared/src/vendas/metas-planilha';

const ABA = "'TNP - RELATORIO VENDAS ANO VS ANO (VND)'";
const COLUNAS = ['BC', 'P', 'BA', 'BB', 'AF', 'CQ', 'DL', 'EG'] as const;
const PRIMEIRA = 34;
const ULTIMA = 1128;
const CINCO_MINUTOS = 5 * 60_000;

export interface MetaTnpLinhaLida {
  data: string;
  linhaPlanilha: number;
  parametros: ParametrosMetaPlanilha;
  meta: MetaTnpDia;
}
export interface MetasTnpLidas { porData: Map<string, MetaTnpLinhaLida>; lidoEm: string }

const celula = (ranges: Array<{ values?: unknown[][] | null }>, indice: number, linha: number): unknown =>
  ranges[indice]?.values?.[linha]?.[0];

function numero(valor: unknown, padrao?: number): number {
  if (valor === undefined || valor === null || valor === '') {
    if (padrao !== undefined) return padrao;
    throw new Error('Metas TNP: campo numérico ausente na planilha.');
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error('Metas TNP: campo numérico inválido na planilha.');
  return n;
}

function dataCivil(valor: unknown): string {
  if (typeof valor === 'number') {
    return new Date(Date.UTC(1899, 11, 30) + valor * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  throw new Error('Metas TNP: data inválida na planilha.');
}

function modoAtual(valor: unknown): ModoMetaPlanilha {
  const texto = String(valor ?? '');
  if (texto.includes('ARRED')) return 'arredondada';
  if (texto.includes('CRESC')) return 'crescida';
  if (texto.includes('ANO ANT')) return 'ajustada';
  throw new Error(`Metas TNP: seletor CN5 não reconhecido (${texto}).`);
}

/**
 * Interpreta somente as colunas necessárias, compara com as fórmulas da aba e
 * aplica as duas correções aprovadas: domingo fechado e tarde residual.
 */
export function interpretarMetasTnp(
  ranges: Array<{ values?: unknown[][] | null }>, hoje: string,
): MetasTnpLidas {
  const modo = modoAtual(celula(ranges, 8, 0));
  const casasArredondamento = numero(celula(ranges, 9, 0));
  const porData = new Map<string, MetaTnpLinhaLida>();
  for (let i = 0; i <= ULTIMA - PRIMEIRA; i += 1) {
    const dataBruta = celula(ranges, 0, i);
    if (dataBruta === undefined || dataBruta === '') continue;
    const data = dataCivil(dataBruta);
    if (porData.has(data)) throw new Error(`Metas TNP: data duplicada na planilha (${data}).`);
    const dataBase = dataBase364DiasAntes(data);
    const baseBruta = celula(ranges, 1, i);
    // P pode ser fórmula que devolve 0 para uma data histórica que ainda não
    // aconteceu. Nunca transformar esse zero futuro em meta válida.
    const base = dataBase > hoje || baseBruta === undefined || baseBruta === ''
      ? null : numero(baseBruta);
    const parametros = {
      ajusteDia: numero(celula(ranges, 2, i), 0),
      crescimentoMes: numero(celula(ranges, 3, i), 0),
      pctManha: numero(celula(ranges, 4, i)),
      modo, casasArredondamento,
    } satisfies ParametrosMetaPlanilha;
    const meta = calcularMetaTnpDia(data, base, parametros);
    if (meta.estado === 'calculada') {
      for (const [indice, calculado] of [
        [5, meta.valores.total], [6, meta.valores.manha], [7, meta.valores.tardePlanilha],
      ] as const) {
        const planilha = numero(celula(ranges, indice, i));
        if (Math.abs(planilha - calculado) > 0.011) {
          throw new Error(`Metas TNP: fórmula divergiu na linha ${PRIMEIRA + i}, coluna ${COLUNAS[indice]}.`);
        }
      }
    }
    porData.set(data, { data, linhaPlanilha: PRIMEIRA + i, parametros, meta });
  }
  return { porData, lidoEm: new Date().toISOString() };
}

/** Nenhum método de escrita; o JWT só tem escopo spreadsheets.readonly. */
export class MetasPlanilhaTnpSource {
  private cache: { dados: MetasTnpLidas; ate: number } | null = null;
  private pendente: Promise<MetasTnpLidas> | null = null;

  async ler(): Promise<MetasTnpLidas> {
    if (this.cache && Date.now() < this.cache.ate) return this.cache.dados;
    if (this.pendente) return this.pendente;
    this.pendente = this.carregar();
    try {
      const dados = await this.pendente;
      this.cache = { dados, ate: Date.now() + CINCO_MINUTOS };
      return dados;
    } finally {
      this.pendente = null;
    }
  }

  private async carregar(): Promise<MetasTnpLidas> {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') {
      throw new Error('Leitura real da planilha de metas proibida em testes.');
    }
    if (!env.METAS_TNP_PLANILHA_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      throw new Error('Planilha de metas TNP ou credenciais Google não configuradas.');
    }
    const auth = new google.auth.JWT({
      email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const ranges = [
      ...COLUNAS.map((col) => `${ABA}!${col}${PRIMEIRA}:${col}${ULTIMA}`),
      `${ABA}!CN5`, `${ABA}!CT8`,
    ];
    const resposta = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: env.METAS_TNP_PLANILHA_ID,
      ranges, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER',
    }, { timeout: 20_000 });
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return interpretarMetasTnp(resposta.data.valueRanges ?? [], hoje);
  }
}
