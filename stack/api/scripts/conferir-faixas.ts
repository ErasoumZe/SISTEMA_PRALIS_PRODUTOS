/** As faixas reais da aba nova, e onde cada campo ambiguo cai. So leitura. */
import 'reflect-metadata';
import 'dotenv/config';
const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';
const letra = (i: number): string => { let s=''; let n=i+1;
  while(n>0){const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26);} return s; };
async function main() {
  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const { faixasDaAba, colunaNaFaixa } = await import('@/modules/google-sheets/sheet-traducao');
  const c = new GoogleSheetsClient();
  const lido = await c.batchGetValues(NOVA, [a1(ABA, 'A3:HT3'), a1(ABA, 'A5:HT5')], 'FORMATTED_VALUE');
  const l3 = ((lido[0] ?? [])[0] ?? []) as string[];
  const l5 = ((lido[1] ?? [])[0] ?? []) as string[];
  const faixas = faixasDaAba(l3, letra);
  console.log(`FAIXAS (${faixas.length}):`);
  for (const f of faixas) console.log(`  ${f.inicio.padStart(3)}..${f.fim.padEnd(3)}  ${f.nome}`);
  console.log('\nCAMPOS AMBIGUOS, resolvidos pela faixa:');
  const casos: Array<[string, string]> = [
    ['CADASTRO GERAL', 'QT'], ['TRANSFORMAÇÃO', 'QT'], ['TRANSFORMAÇÃO', 'UN'],
    ['TNP - CADASTRO', 'CUSTO'], ['LI - CADASTRO', 'CUSTO'],
    ['TNP - CADASTRO', 'CODIGO INT.'], ['LI - CADASTRO', 'CODIGO INT.'],
    ['TNP - CADASTRO', 'MARGEM PONTUAL %'], ['LI - CADASTRO', 'MARGEM PONTUAL %'],
    ['TNP - CADASTRO', 'ESTOQUE MIN'], ['LI - CADASTRO', 'ESTOQUE MIN'],
  ];
  for (const [faixa, campo] of casos) {
    const col = colunaNaFaixa(l5, faixas, faixa, campo, letra);
    console.log(`  ${faixa.padEnd(18)} ${campo.padEnd(20)} -> ${col ?? '(nao existe nessa faixa)'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
