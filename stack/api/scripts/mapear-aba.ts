/**
 * Mapa completo de uma aba: cabeçalho de cada coluna e quantas linhas têm
 * valor nela. Sem isso não dá para dizer qual coluna é chave de junção nem
 * qual coluna fiscal está de fato preenchida.
 *
 * uso: tsx scripts/mapear-aba.ts <spreadsheetId> "<aba>" <linhaCabecalho> <primeiraLinhaDados>
 * Só leitura.
 */
import 'reflect-metadata';
import 'dotenv/config';

const normal = (v: unknown): string =>
  String(v ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();

async function main() {
  const [, , planilha, aba, cabStr, dadosStr] = process.argv;
  const linhaCab = Number(cabStr ?? 6);
  const primeiraDados = Number(dadosStr ?? 7);
  if (!planilha || !aba) { console.error('uso: <id> "<aba>" [linhaCabecalho] [primeiraLinhaDados]'); process.exit(1); }

  const { GoogleSheetsClient, a1, indexToCol } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();
  const meta = (await c.getSheets(planilha)).find((a) => a.title === aba);
  if (!meta) { console.error(`aba "${aba}" nao existe`); process.exit(1); }

  const ate = indexToCol(Math.max(0, meta.columnCount - 1));
  const [cab, corpo] = await c.batchGetValues(planilha, [
    a1(aba, `A${linhaCab}:${ate}${linhaCab}`),
    a1(aba, `A${primeiraDados}:${ate}${meta.rowCount}`),
  ], 'FORMATTED_VALUE');

  const cabecalhos = ((cab ?? [])[0] ?? []) as string[];
  const linhas = (corpo ?? []) as string[][];
  const total = linhas.length;

  console.log(`ABA "${aba}"  ${meta.rowCount}x${meta.columnCount}`);
  console.log(`cabecalho na linha ${linhaCab}; dados a partir da ${primeiraDados}; ${total} linhas lidas\n`);
  console.log('col  preenchidas  %      cabecalho                                exemplo');
  console.log('-'.repeat(112));

  const largura = Math.max(cabecalhos.length, ...linhas.map((l) => (l ?? []).length));
  for (let i = 0; i < largura; i += 1) {
    const nome = normal(cabecalhos[i]);
    let preenchidas = 0;
    let exemplo = '';
    for (const l of linhas) {
      const v = normal((l ?? [])[i]);
      if (v === '') continue;
      preenchidas += 1;
      if (!exemplo) exemplo = v.slice(0, 30);
    }
    if (!nome && preenchidas === 0) continue;
    const pct = total ? Math.round((preenchidas / total) * 100) : 0;
    console.log(
      `${indexToCol(i).padEnd(5)}${String(preenchidas).padStart(8)}  ${String(pct).padStart(3)}%   `
      + `${(nome || '(sem cabecalho)').slice(0, 38).padEnd(40)} ${exemplo}`,
    );
  }
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
