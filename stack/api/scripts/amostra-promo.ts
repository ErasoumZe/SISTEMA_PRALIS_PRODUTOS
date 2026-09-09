import 'reflect-metadata';
import 'dotenv/config';
const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ANTIGA = '1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w';
async function main() {
  const { env } = await import('@/config/env');
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();
  const ver = async (id: string, aba: string, cols: string[], rotulo: string) => {
    env.GOOGLE_SHEETS_SPREADSHEET_ID = id;
    const lido = await c.batchGetValues(id, cols.map((x) => a1(aba, `${x}5:${x}60`)), 'FORMATTED_VALUE');
    console.log(`\n### ${rotulo}`);
    cols.forEach((col, i) => {
      const v = (lido[i] ?? []).map((r: any) => String(r?.[0] ?? '').trim());
      const dados = v.slice(6).filter(Boolean).slice(0, 5);
      console.log(`  ${col.padStart(3)} "${(v[0] ?? '').slice(0, 34)}"  dados: ${dados.join(' | ') || '(vazio)'}`);
    });
  };
  await ver(ANTIGA, '(BASE) CADASTRO PRODUTOS', ['C', 'D', 'E'], 'ANTIGA (BASE) — LOJAS');
  await ver(NOVA, '(TNP/LI) CADASTRO PRODUTOS', ['C', 'D', 'E'], 'NOVA (TNP/LI) — inicio');
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
