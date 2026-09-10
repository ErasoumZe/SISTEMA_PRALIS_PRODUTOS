/**
 * Copia a aba FISCAL da planilha antiga para a nova, oculta.
 *
 * A planilha nova não tem tabela de regra fiscal por grupo, e sem ela o
 * cadastro para inteiro: nenhum grupo carrega e nada pode ser salvo.
 *
 * Copia VALORES, não fórmulas: as fórmulas da aba antiga apontam para abas da
 * planilha antiga e viriam quebradas. É uma tabela de consulta — o valor é o
 * que importa.
 *
 * Conferência por padrão; grava só com `--gravar`. Idempotente: se a aba já
 * existir na nova, não recria.
 */
import 'reflect-metadata';
import 'dotenv/config';

const ANTIGA = '1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w';
const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP) FISCAL - DE PARA PRODUTOS';

/** Faixas que o TaxRuleService lê. Copiar o bloco que as cobre. */
const ATE_COLUNA = 'AG';
const ATE_LINHA = 2000;

async function main() {
  const gravar = process.argv.includes('--gravar');
  const { env } = await import('@/config/env');
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');

  // ---- ja existe na nova? ----
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const abasNovas = await c.getSheets(NOVA);
  if (abasNovas.some((a) => a.title === ABA)) {
    console.log(`\n  a aba "${ABA}" JA existe na planilha nova — nada a fazer`);
    process.exit(0);
  }

  // ---- ler da antiga ----
  env.GOOGLE_SHEETS_SPREADSHEET_ID = ANTIGA;
  const [valores] = await c.batchGetValues(
    ANTIGA, [a1(ABA, `A1:${ATE_COLUNA}${ATE_LINHA}`)], 'FORMATTED_VALUE',
  );
  const linhas = (valores ?? []) as string[][];
  const comConteudo = linhas.filter((l) => (l ?? []).some((v) => String(v ?? '').trim() !== '')).length;

  console.log(`\n  origem : ${ABA} da planilha antiga`);
  console.log(`  lidas  : ${linhas.length} linhas, ${comConteudo} com conteúdo`);
  console.log(`  destino: mesma aba na planilha nova, OCULTA`);

  // amostra do que importa: a tabela de grupos fica em AB4:AG79
  const amostra = linhas.slice(3, 7).map((l) => (l ?? []).slice(27, 33).map((v) => String(v ?? '').slice(0, 14)).join(' | '));
  console.log('  amostra da tabela de grupos (AB..AG, linhas 4-7):');
  amostra.forEach((a) => console.log(`     ${a}`));

  if (!gravar) process.exit(0);
  if (comConteudo === 0) {
    console.log('\n  !! a origem veio vazia — nao crio aba vazia');
    process.exit(1);
  }

  // ---- criar e preencher na nova ----
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  await c.batchUpdate(NOVA, [{
    addSheet: {
      properties: {
        title: ABA,
        hidden: true,
        gridProperties: { rowCount: Math.max(linhas.length, 100), columnCount: 40 },
      },
    },
  }]);

  // em blocos: um único update com 2.000 linhas estoura o limite da requisição
  const BLOCO = 400;
  for (let i = 0; i < linhas.length; i += BLOCO) {
    const pedaco = linhas.slice(i, i + BLOCO).map((l) => (l ?? []).map((v) => String(v ?? '')));
    await c.batchUpdateValues(
      NOVA,
      [{ range: a1(ABA, `A${i + 1}:${ATE_COLUNA}${i + pedaco.length}`), values: pedaco }],
      'RAW',
    );
    console.log(`  gravadas linhas ${i + 1}..${i + pedaco.length}`);
  }

  console.log('\n  aba criada, preenchida e OCULTA');
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
