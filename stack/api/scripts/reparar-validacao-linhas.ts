/**
 * Devolve a validação de dados às linhas que a perderam.
 *
 * Por que elas perderam
 * ---------------------
 * `copiarEstrutura` copiava formato e validação da linha IMEDIATAMENTE
 * ANTERIOR. O erro aí é cumulativo: basta UMA linha sem validação para a
 * seguinte herdar o "sem validação" e passar adiante, para sempre. Nenhuma
 * requisição falha — a planilha só vai perdendo os controles, linha a linha.
 *
 * Na aba oficial isso apareceu em 16/09/2026 na coluna de status, que é um
 * checkbox de valores personalizados (`ATIVO` marcado, `INATIVO` desmarcado):
 * o valor continuava certo, mas sem a validação virava texto solto. O estrago
 * real era maior — as linhas afetadas perderam as 52 colunas de validação,
 * todas as listas suspensas junto.
 *
 * O serviço já foi corrigido para copiar da linha-modelo fixa. Este script
 * conserta o que ficou para trás; linha nova nasce certa sem ele.
 *
 * Conferência por padrão; grava só com `--gravar`.
 *
 * Uso:  cd stack/api && npx tsx scripts/reparar-validacao-linhas.ts [--gravar]
 */
import 'reflect-metadata';
import 'dotenv/config';
import { google } from 'googleapis';

/** A mesma linha-modelo que o serviço usa para fórmulas e validação. */
const LINHA_MODELO = 12;
const PRIMEIRA_LINHA_DADOS = 11;

async function main() {
  const gravar = process.argv.includes('--gravar');
  const { env } = await import('@/config/env');
  const ID = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const ABA = env.GOOGLE_SHEETS_BASE_TAB;
  if (!ID) {
    console.log('GOOGLE_SHEETS_SPREADSHEET_ID vazio — sem destino, nao faco nada.');
    process.exit(1);
  }

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');
  console.log(`  planilha: ${ID}`);
  console.log(`  aba     : ${ABA}`);
  console.log(`  modelo  : linha ${LINHA_MODELO}`);

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: ID,
    fields: 'sheets.properties(sheetId,title,gridProperties)',
  });
  const aba = meta.data.sheets?.find((s) => s.properties?.title === ABA)?.properties;
  if (!aba) {
    console.log(`  a aba "${ABA}" nao existe.`);
    process.exit(1);
  }
  const totalLinhas = aba.gridProperties?.rowCount ?? 0;
  const totalColunas = aba.gridProperties?.columnCount ?? 0;

  /*
   * A linha-modelo precisa estar boa ANTES de virar fonte. Copiar de uma
   * linha sem validação espalharia o problema em vez de consertá-lo — que é
   * exatamente o defeito que trouxe a planilha até aqui.
   */
  const doModelo = await sheets.spreadsheets.get({
    spreadsheetId: ID,
    ranges: [`'${ABA}'!A${LINHA_MODELO}:${totalColunas}`],
    includeGridData: true,
    fields: 'sheets.data.rowData.values(dataValidation.condition.type)',
  });
  const colunasDoModelo = (doModelo.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values ?? [])
    .filter((v) => v.dataValidation).length;
  if (colunasDoModelo === 0) {
    console.log(`  a linha-modelo ${LINHA_MODELO} nao tem validacao nenhuma — nao copio dela.`);
    process.exit(1);
  }
  console.log(`  modelo tem ${colunasDoModelo} colunas com validacao`);

  // ---- quem perdeu ----
  const grade = await sheets.spreadsheets.get({
    spreadsheetId: ID,
    ranges: [`'${ABA}'!C${PRIMEIRA_LINHA_DADOS}:D${totalLinhas}`],
    includeGridData: true,
    fields: 'sheets.data.rowData.values(formattedValue,dataValidation.condition.type)',
  });
  const linhas = grade.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  const afetadas: number[] = [];
  linhas.forEach((l, i) => {
    const nome = String(l.values?.[1]?.formattedValue ?? '').trim();
    if (!nome) return;                       // linha sem produto nao precisa
    if (!l.values?.[0]?.dataValidation) afetadas.push(PRIMEIRA_LINHA_DADOS + i);
  });

  console.log(`\n  linhas com produto e SEM validacao: ${afetadas.length}`);
  if (afetadas.length === 0) {
    console.log('  nada a reparar.');
    process.exit(0);
  }

  /* Agrupa em blocos contiguos: uma requisicao por bloco, nao por linha. */
  const blocos: Array<[number, number]> = [];
  for (const linha of afetadas) {
    const ultimo = blocos[blocos.length - 1];
    if (ultimo && linha === ultimo[1] + 1) ultimo[1] = linha;
    else blocos.push([linha, linha]);
  }
  console.log(`  em ${blocos.length} bloco(s) contiguo(s):`);
  blocos.slice(0, 10).forEach(([a, b]) => console.log(`    ${a}..${b}  (${b - a + 1} linha(s))`));
  if (blocos.length > 10) console.log(`    ... e mais ${blocos.length - 10}`);

  if (!gravar) {
    console.log('\n  rode de novo com --gravar para aplicar.');
    process.exit(0);
  }

  /*
   * SÓ `PASTE_DATA_VALIDATION`. Formato e fórmula ficam de fora de propósito:
   * as linhas ja estao preenchidas e formatadas, e colar formato por cima
   * mexeria em aparencia que ninguem pediu para mudar. O que falta nelas e a
   * validacao, e so ela e reposta.
   */
  const requests = blocos.map(([inicio, fim]) => ({
    copyPaste: {
      source: {
        sheetId: aba.sheetId,
        startRowIndex: LINHA_MODELO - 1,
        endRowIndex: LINHA_MODELO,
        startColumnIndex: 0,
        endColumnIndex: totalColunas,
      },
      destination: {
        sheetId: aba.sheetId,
        startRowIndex: inicio - 1,
        endRowIndex: fim,
        startColumnIndex: 0,
        endColumnIndex: totalColunas,
      },
      pasteType: 'PASTE_DATA_VALIDATION',
    },
  }));

  // em lotes: um batchUpdate gigante estoura o limite da requisicao
  const LOTE = 20;
  for (let i = 0; i < requests.length; i += LOTE) {
    const pedaco = requests.slice(i, i + LOTE);
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: pedaco } });
    console.log(`  aplicados ${i + pedaco.length}/${requests.length} bloco(s)`);
  }

  console.log('\n  validacao reposta. Confira um produto na planilha: a coluna de');
  console.log('  status deve voltar a ser checkbox, marcado quando ATIVO.');
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
