/**
 * Nomeia um cabecalho que existe como coluna mas esta sem nome na linha 5.
 *
 * A coluna I da aba nova ja guarda `C/` e `DE` em toda linha, mas nao tem
 * cabecalho — entao a traducao por nome nao a encontra. Nomear e o suficiente;
 * nao mexe em nenhum dado.
 *
 * Conferencia por padrao; grava so com --gravar.
 */
import 'reflect-metadata';
import 'dotenv/config';

const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const LINHA_CABECALHO = 5;

/** aba -> coluna -> nome. So colunas comprovadamente daquele campo. */
const NOMEAR: Array<{ aba: string; coluna: string; nome: string; esperado: RegExp }> = [
  { aba: '(TNP/LI) CADASTRO PRODUTOS', coluna: 'I', nome: 'C/DE', esperado: /^(C\/|DE)$/ },
  { aba: '(TNP) CADASTRO PRODUTOS', coluna: 'I', nome: 'C/DE', esperado: /^(C\/|DE)$/ },
  { aba: '(LI) CADASTRO PRODUTOS', coluna: 'I', nome: 'C/DE', esperado: /^(C\/|DE)$/ },
];

async function main() {
  const gravar = process.argv.includes('--gravar');
  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const { normalizarCabecalho } = await import('@/modules/google-sheets/sheet-traducao');
  const c = new GoogleSheetsClient();

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');

  for (const alvo of NOMEAR) {
    const [vals] = await c.batchGetValues(
      NOVA, [a1(alvo.aba, `${alvo.coluna}${LINHA_CABECALHO}:${alvo.coluna}30`)], 'FORMATTED_VALUE',
    );
    const col = (vals ?? []).map((r) => String((r as string[])?.[0] ?? '').trim());
    const cabecalho = col[0] ?? '';
    const amostra = col.slice(6).filter(Boolean).slice(0, 8);

    console.log(`\n${alvo.aba}  coluna ${alvo.coluna}`);
    if (normalizarCabecalho(cabecalho)) {
      console.log(`   ja tem cabecalho "${cabecalho}" — nao mexo`);
      continue;
    }
    // so nomeia se os DADOS forem do campo que eu penso que e
    const batem = amostra.length > 0 && amostra.every((v) => alvo.esperado.test(v));
    console.log(`   amostra: ${amostra.join(' | ') || '(vazia)'}`);
    if (!batem) {
      console.log(`   !! os dados NAO parecem de "${alvo.nome}" — nao nomeio no escuro`);
      continue;
    }
    console.log(`   vai receber o cabecalho "${alvo.nome}"`);
    if (!gravar) continue;
    await c.batchUpdateValues(
      NOVA, [{ range: a1(alvo.aba, `${alvo.coluna}${LINHA_CABECALHO}`), values: [[alvo.nome]] }], 'RAW',
    );
    console.log('   gravado');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
