/** Cabecalhos da BASE antiga X aba nova, por letra. So leitura. */
import 'reflect-metadata';
import 'dotenv/config';
const ANTIGA = '1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w';
const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const letra = (i: number): string => { let s=''; let n=i+1;
  while(n>0){const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26);} return s; };
async function main() {
  const { env } = await import('@/config/env');
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const { normalizarCabecalho } = await import('@/modules/google-sheets/sheet-traducao');
  const c = new GoogleSheetsClient();
  const ler = async (id: string, aba: string) => {
    env.GOOGLE_SHEETS_SPREADSHEET_ID = id;
    const [v] = await c.batchGetValues(id, [a1(aba, 'A5:IZ5')], 'FORMATTED_VALUE');
    const m = new Map<string, string>();
    (((v ?? [])[0] ?? []) as string[]).forEach((x, i) => { const n = normalizarCabecalho(x); if (n) m.set(letra(i), n); });
    return m;
  };
  const antiga = await ler(ANTIGA, '(BASE) CADASTRO PRODUTOS');
  const nova = await ler(NOVA, '(TNP/LI) CADASTRO PRODUTOS');
  const nomesNovos = new Set(nova.values());
  console.log(`BASE antiga: ${antiga.size} cabecalhos | (TNP/LI) nova: ${nova.size}`);
  console.log('\n### colunas que o mapper escreve (C..CA) e o que a nova tem com o MESMO nome:');
  for (const [l, nome] of antiga) {
    if (l.length > 2) continue;
    const igual = nomesNovos.has(nome);
    console.log(`  ${l.padStart(3)} ${nome.slice(0, 40).padEnd(42)} ${igual ? 'existe na nova' : '--- SEM equivalente de mesmo nome'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
