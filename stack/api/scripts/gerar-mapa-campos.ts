/** Gera a tabela letra-da-BASE-antiga -> nome do campo. Roda uma vez. */
import 'reflect-metadata';
import 'dotenv/config';
const ANTIGA = '1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w';
async function main() {
  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = ANTIGA;
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const { normalizarCabecalho } = await import('@/modules/google-sheets/sheet-traducao');
  const { INPUT_COLUMNS } = await import('@/modules/google-sheets/product-sheet.mapper');
  const c = new GoogleSheetsClient();
  const [v] = await c.batchGetValues(ANTIGA, [a1('(BASE) CADASTRO PRODUTOS', 'A5:IZ5')], 'FORMATTED_VALUE');
  const cab = (((v ?? [])[0] ?? []) as string[]).map(normalizarCabecalho);
  const linhas: string[] = [];
  for (const col of INPUT_COLUMNS) {
    const i = col.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const nome = cab[i] ?? '';
    linhas.push(nome ? `  ${col}: '${nome.replace(/'/g, "\'")}',` : `  // ${col}: sem cabecalho na BASE antiga`);
  }
  console.log(linhas.join('\n'));
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
