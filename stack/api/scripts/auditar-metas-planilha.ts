/** Auditoria somente leitura: confronta o cálculo corrigido com CQ/DL/EG. */
import { google } from 'googleapis';
import { calcularMetaPlanilha, type ModoMetaPlanilha } from '../../shared/src/vendas/metas-planilha';

const id = process.argv[2];
if (!id) throw new Error('Informe o ID da planilha como argumento.');
const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
if (!email || !privateKey) throw new Error('Credenciais Google não configuradas.');

const auth = new google.auth.JWT({
  email, key: privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });
const tab = "'TNP - RELATORIO VENDAS ANO VS ANO (VND)'";
const colunas = ['BC', 'P', 'BA', 'BB', 'AF', 'CQ', 'DL', 'EG'];
const ranges = [...colunas.map((coluna) => `${tab}!${coluna}34:${coluna}764`), `${tab}!CN5`, `${tab}!CT8`];
const resposta = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: id, ranges, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER',
});
const valores = resposta.data.valueRanges ?? [];
const coluna = (indice: number, linha: number): unknown => valores[indice]?.values?.[linha]?.[0];
const numero = (valor: unknown, padrao?: number): number => {
  if (valor === '' || valor === null || valor === undefined) {
    if (padrao !== undefined) return padrao;
    throw new Error('Valor numérico ausente.');
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error('Valor numérico inválido.');
  return n;
};
const seletor = String(valores[8]?.values?.[0]?.[0] ?? '');
const modo: ModoMetaPlanilha = seletor.includes('ARRED') ? 'arredondada'
  : seletor.includes('CRESC') ? 'crescida' : 'ajustada';
const casas = numero(valores[9]?.values?.[0]?.[0]);

const divergencias: Array<{ linha: number; data: string; campo: string; planilha: number; calculado: number }> = [];
let comparadas = 0;
let semBase = 0;
let baseZero = 0;
let basePositiva = 0;
let tarderesidual = 0;
const residuais: Array<{ linha: number; data: string; diferenca: number }> = [];
const dataSerial = (serial: number) => new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);

for (let i = 0; i <= 764 - 34; i += 1) {
  const dataBruta = coluna(0, i);
  if (dataBruta === undefined || dataBruta === '') continue;
  const data = typeof dataBruta === 'number' ? dataSerial(dataBruta) : String(dataBruta);
  const baseBruta = coluna(1, i);
  if (baseBruta === undefined || baseBruta === '') { semBase += 1; continue; }
  const base = numero(baseBruta);
  if (base === 0) baseZero += 1;
  else basePositiva += 1;
  const calculado = calcularMetaPlanilha(base, {
    ajusteDia: numero(coluna(2, i), 0), crescimentoMes: numero(coluna(3, i), 0),
    pctManha: numero(coluna(4, i)), modo, casasArredondamento: casas,
  });
  comparadas += 1;
  for (const [campo, indice, obtido] of [
    ['CQ', 5, calculado.total], ['DL', 6, calculado.manha], ['EG', 7, calculado.tardePlanilha],
  ] as const) {
    const esperado = numero(coluna(indice, i));
    if (Math.abs(esperado - obtido) > 0.011) {
      divergencias.push({ linha: i + 34, data, campo, planilha: esperado, calculado: obtido });
    }
  }
  if (Math.abs(calculado.diferencaTardePlanilha) > 0.011) {
    tarderesidual += 1;
    residuais.push({ linha: i + 34, data, diferenca: calculado.diferencaTardePlanilha });
  }
}

console.log(JSON.stringify({ modo, casas, comparadas, semBase, baseZero, basePositiva, tarderesidual,
  residuaisPorValor: Object.fromEntries(
    [...new Set(residuais.map((r) => r.diferenca))]
      .sort((a, b) => a - b)
      .map((valor) => [String(valor), residuais.filter((r) => r.diferenca === valor).length]),
  ),
  residuaisExemplos: residuais.filter((r) => Math.abs(r.diferenca) > 100).slice(0, 10),
  divergencias: divergencias.length, exemplos: divergencias.slice(0, 20) }, null, 2));
if (divergencias.length) process.exitCode = 1;
