/**
 * Varre uma planilha inteira atrás das colunas fiscais.
 *
 * Existe porque "está em umas colunas ocultas, se não me engano" não é
 * endereço: a aba pode ter 248 colunas e o cabeçalho não estar na linha 1.
 * Lê as primeiras linhas de TODAS as abas e marca toda coluna cujo cabeçalho
 * cheira a fiscal, dizendo a letra exata e quantas linhas têm valor.
 *
 * Só leitura.
 */
import 'reflect-metadata';
import 'dotenv/config';

const TERMOS = [
  'NCM', 'CST', 'CEST', 'ICMS', 'PIS', 'COFINS', 'ALIQ', 'ALÍQ', 'FCP',
  'TRIBUT', 'REDUCAO', 'REDUÇÃO', 'FISCAL', 'ECF', 'CSOSN', 'CFOP', 'IBS', 'CBS',
  'CLASSTRIB', 'MONOFAS', 'MONOFÁS', 'ORIGEM',
];

const normal = (v: unknown): string =>
  String(v ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');

async function main() {
  const planilha = process.argv[2];
  const linhasCabecalho = Number(process.argv[3] ?? 12);
  if (!planilha) { console.error('uso: tsx scripts/achar-fiscal.ts <spreadsheetId> [linhas]'); process.exit(1); }

  const { GoogleSheetsClient, a1, indexToCol } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();
  const abas = await c.getSheets(planilha);

  for (const aba of abas) {
    const ate = indexToCol(Math.max(0, aba.columnCount - 1));
    let topo: string[][];
    try {
      const [lido] = await c.batchGetValues(planilha, [a1(aba.title, `A1:${ate}${linhasCabecalho}`)], 'FORMATTED_VALUE');
      topo = (lido ?? []) as string[][];
    } catch { console.log(`\n### ${aba.title}: nao consegui ler`); continue; }

    // uma coluna pode ter cabeçalho em qualquer das primeiras linhas
    const achados: Array<{ col: string; linha: number; texto: string }> = [];
    topo.forEach((linha, l) => {
      (linha ?? []).forEach((celula, i) => {
        const t = normal(celula);
        if (!t || t.length > 40) return;
        if (TERMOS.some((termo) => t.includes(termo))) {
          achados.push({ col: indexToCol(i), linha: l + 1, texto: t });
        }
      });
    });

    if (achados.length === 0) continue;
    console.log(`\n### ${aba.title}  (${aba.rowCount}x${aba.columnCount}) — ${achados.length} colunas fiscais`);
    for (const a of achados) console.log(`   ${a.col.padEnd(4)} L${String(a.linha).padStart(2)}  ${a.texto}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
