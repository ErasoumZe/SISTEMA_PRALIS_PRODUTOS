/** O que existe de fato nas colunas duvidosas da aba nova. So leitura. */
import 'reflect-metadata';
import 'dotenv/config';
const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';
async function main() {
  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();
  const cols = ['I', 'P', 'Q', 'R', 'S', 'T', 'U'];
  const lido = await c.batchGetValues(NOVA, cols.map((x) => a1(ABA, `${x}5:${x}20`)), 'FORMATTED_VALUE');
  cols.forEach((col, i) => {
    const v = (lido[i] ?? []).map((r: any) => String(r?.[0] ?? '').trim());
    const cabecalho = v[0] || '(SEM CABECALHO)';
    const dados = v.slice(6).filter(Boolean).slice(0, 6); // a partir da linha 11
    console.log(`  ${col.padStart(2)}  cab="${cabecalho.slice(0, 46)}"`);
    console.log(`      dados: ${dados.join(' | ') || '(vazio nas primeiras linhas)'}`);
  });
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
