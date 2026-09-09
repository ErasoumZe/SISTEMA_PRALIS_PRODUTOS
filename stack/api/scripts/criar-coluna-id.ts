/**
 * Cria a coluna `ID` nas abas de cadastro da planilha NOVA, no fim e oculta.
 *
 * Sem `ID` o espelho nao tem como reencontrar o produto e passa a criar uma
 * linha nova a cada sincronismo. E a unica coluna obrigatoria.
 *
 * Roda em CONFERENCIA por padrao. Grava so com `--gravar`.
 */
import 'reflect-metadata';
import 'dotenv/config';

const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABAS = ['(TNP/LI) CADASTRO PRODUTOS', '(TNP) CADASTRO PRODUTOS', '(LI) CADASTRO PRODUTOS'];
const LINHA_CABECALHO = 5;

const letra = (i: number): string => {
  let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

async function main() {
  const gravar = process.argv.includes('--gravar');
  const { env } = await import('./config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const { GoogleSheetsClient, a1 } = await import('./modules/google-sheets/google-sheets.client');
  const { normalizarCabecalho } = await import('./modules/google-sheets/sheet-traducao');
  const c = new GoogleSheetsClient();
  const abas = await c.getSheets(NOVA);

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');

  for (const titulo of ABAS) {
    const meta = abas.find((a) => a.title === titulo);
    if (!meta) { console.log(`\n!! aba nao encontrada: ${titulo}`); continue; }
    const largura = (meta as unknown as { columnCount?: number }).columnCount ?? 0;

    // varre a grade INTEIRA nas linhas de cabecalho e nas primeiras de dados
    const fim = letra(Math.max(0, largura - 1));
    const [vals] = await c.batchGetValues(NOVA, [a1(titulo, `A1:${fim}20`)], 'FORMATTED_VALUE');

    let ultima = -1;
    let jaTemId: string | null = null;
    (vals ?? []).forEach((linha, i) => {
      (linha as unknown[]).forEach((v, j) => {
        const s = String(v ?? '').trim();
        if (s === '') return;
        if (j > ultima) ultima = j;
        if (i + 1 === LINHA_CABECALHO && normalizarCabecalho(s) === 'ID') jaTemId = letra(j);
      });
    });

    if (jaTemId) {
      console.log(`\n${titulo}\n   ja tem ID em ${jaTemId} — nada a fazer`);
      continue;
    }

    const alvo = ultima + 1;
    if (alvo >= largura) {
      console.log(`\n${titulo}\n   !! a grade termina em ${letra(largura - 1)} e o conteudo tambem. `
        + 'Seria preciso acrescentar coluna a grade; nao faco isso sem avisar.');
      continue;
    }

    console.log(`\n${titulo}`);
    console.log(`   grade ate ${letra(largura - 1)} | conteudo ate ${letra(ultima)} | ID vai para ${letra(alvo)}${LINHA_CABECALHO}`);

    if (!gravar) continue;

    await c.batchUpdateValues(
      NOVA,
      [{ range: a1(titulo, `${letra(alvo)}${LINHA_CABECALHO}`), values: [['ID']] }],
      'RAW',
    );
    await c.batchUpdate(NOVA, [{
      updateDimensionProperties: {
        range: { sheetId: meta.sheetId, dimension: 'COLUMNS', startIndex: alvo, endIndex: alvo + 1 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
      },
    }]);
    console.log(`   gravado e ocultado`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
