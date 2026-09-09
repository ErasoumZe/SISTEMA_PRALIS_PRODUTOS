/**
 * Cria no FIM da aba, ocultas, as colunas que o cadastro tem e a planilha nova
 * nao: QUANTIDADE, MEDIDA BASE e MEDIDA (medida de compra).
 *
 * No fim e ocultas de proposito: nenhuma formula da planilha aponta para
 * coluna nova, e o Creare le do banco, nao da planilha — entao nada aqui muda
 * o comportamento de nenhum dos dois. A planilha so passa a GUARDAR o dado.
 *
 * Conferencia por padrao; grava so com --gravar. Idempotente.
 */
import 'reflect-metadata';
import 'dotenv/config';

const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const LINHA_CABECALHO = 5;
const ABAS = ['(TNP/LI) CADASTRO PRODUTOS', '(TNP) CADASTRO PRODUTOS', '(LI) CADASTRO PRODUTOS'];
const NOVAS = ['QUANTIDADE', 'MEDIDA BASE', 'MEDIDA'];

const letra = (i: number): string => { let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

async function main() {
  const gravar = process.argv.includes('--gravar');
  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const { normalizarCabecalho } = await import('@/modules/google-sheets/sheet-traducao');
  const c = new GoogleSheetsClient();
  const abas = await c.getSheets(NOVA);

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');

  for (const titulo of ABAS) {
    const meta = abas.find((a) => a.title === titulo);
    if (!meta) { console.log(`\n!! aba ausente: ${titulo}`); continue; }
    const largura = (meta as unknown as { columnCount: number }).columnCount;

    const [vals] = await c.batchGetValues(
      NOVA, [a1(titulo, `A${LINHA_CABECALHO}:${letra(largura - 1)}${LINHA_CABECALHO}`)], 'FORMATTED_VALUE',
    );
    const cabecalhos = (((vals ?? [])[0] ?? []) as string[]).map(normalizarCabecalho);
    const jaTem = new Set(cabecalhos.filter(Boolean));
    const faltam = NOVAS.filter((n) => !jaTem.has(n));

    // primeira coluna livre = depois da ultima com QUALQUER conteudo
    let ultima = -1;
    cabecalhos.forEach((n, i) => { if (n) ultima = Math.max(ultima, i); });

    console.log(`\n${titulo}`);
    console.log(`   grade ate ${letra(largura - 1)} | ultimo cabecalho em ${letra(ultima)}`);
    if (faltam.length === 0) { console.log('   ja tem as tres — nada a fazer'); continue; }

    const inicio = ultima + 1;
    const precisaEsticar = inicio + faltam.length > largura;
    console.log(`   faltam: ${faltam.join(', ')}`);
    console.log(`   vao para ${letra(inicio)}..${letra(inicio + faltam.length - 1)}`
      + (precisaEsticar ? `  (a grade precisa crescer ${inicio + faltam.length - largura} coluna(s))` : ''));
    if (!gravar) continue;

    if (precisaEsticar) {
      await c.batchUpdate(NOVA, [{
        appendDimension: {
          sheetId: meta.sheetId, dimension: 'COLUMNS', length: inicio + faltam.length - largura,
        },
      }]);
    }
    await c.batchUpdateValues(
      NOVA,
      faltam.map((nome, k) => ({ range: a1(titulo, `${letra(inicio + k)}${LINHA_CABECALHO}`), values: [[nome]] })),
      'RAW',
    );
    await c.batchUpdate(NOVA, [{
      updateDimensionProperties: {
        range: { sheetId: meta.sheetId, dimension: 'COLUMNS', startIndex: inicio, endIndex: inicio + faltam.length },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
      },
    }]);
    console.log('   criadas e ocultadas');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
