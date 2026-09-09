/**
 * Para cada campo que o espelho escreve, em QUE COLUNA da planilha nova ele
 * cai — separando BASE, TNP e LI. So leitura.
 */
import 'reflect-metadata';
import 'dotenv/config';
const ANTIGA = '1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w';
const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';

/** Desempate para os nomes que existem em duas faixas nao-loja. */
const DESEMPATE: Record<string, string> = {
  'QT_TR': 'TRANSFORMAÇÃO',
  'UN': 'TRANSFORMAÇÃO',
  'QT_CAD': 'CADASTRO GERAL',
};
/** Mesmo campo, nome diferente nas duas planilhas. */
const APELIDOS: Record<string, string> = {
  'A/I': 'V',
  NOME: 'CADASTRO PRODUTOS ATUALIZADO NOVO',
  QT_CAD: 'QT',
  QT_TR: 'QT',
};

const letra = (i: number): string => { let s=''; let n=i+1;
  while(n>0){const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26);} return s; };

async function main() {
  const { env } = await import('@/config/env');
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const { normalizarCabecalho, faixasDaAba, resolverDestino } = await import('@/modules/google-sheets/sheet-traducao');
  const { INPUT_COLUMNS } = await import('@/modules/google-sheets/product-sheet.mapper');
  const c = new GoogleSheetsClient();

  env.GOOGLE_SHEETS_SPREADSHEET_ID = ANTIGA;
  const [antigaCab] = await c.batchGetValues(ANTIGA, [a1('(BASE) CADASTRO PRODUTOS', 'A5:IZ5')], 'FORMATTED_VALUE');
  const antiga = (((antigaCab ?? [])[0] ?? []) as string[]).map(normalizarCabecalho);

  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const lido = await c.batchGetValues(NOVA, [a1(ABA, 'A3:IZ3'), a1(ABA, 'A5:IZ5')], 'FORMATTED_VALUE');
  const l3 = ((lido[0] ?? [])[0] ?? []) as string[];
  const l5 = ((lido[1] ?? [])[0] ?? []) as string[];
  const faixas = faixasDaAba(l3, letra, l5.length);

  const linhas: Array<[string, string, string, string, string]> = [];
  for (const col of INPUT_COLUMNS) {
    const idx = col.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const bruto = antiga[idx] ?? '';
    if (!bruto) continue;
    const nome = APELIDOS[bruto] ?? bruto;
    const faixa = DESEMPATE[bruto];
    const co = (loja?: string) => resolverDestino({ nome, loja, faixa, faixas, cabecalhos: l5, letra }) ?? '-';
    linhas.push([col, bruto.slice(0, 30), co(), co('TNP'), co('LI')]);
  }

  console.log('  DE   CAMPO                          BASE   TNP    LI');
  for (const [c1, c2, c3, c4, c5] of linhas) {
    console.log(`  ${c1.padStart(3)}  ${c2.padEnd(30)} ${c3.padStart(5)} ${c4.padStart(5)} ${c5.padStart(5)}`);
  }
  const semDestino = linhas.filter(([, , b, t, l]) => b === '-' && t === '-' && l === '-');
  console.log(`\n  campos sem destino em nenhuma faixa: ${semDestino.length}`);
  semDestino.forEach(([c1, c2]) => console.log(`    ${c1} ${c2}`));
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
