/**
 * Raio-x SOMENTE LEITURA do leiaute de loja na planilha nova.
 *
 * Responde tres perguntas que nao dao para responder de fora:
 *  1. quais colunas da faixa da loja sao FORMULA (nunca escrever) e quais sao
 *     entrada de verdade;
 *  2. o que a formula de V. VENDA realmente usa como base;
 *  3. se a aba `(LI) CADASTRO PRODUTOS` tem alinhamento de linha com a aba
 *     combinada — a premissa em que o espelho novo se apoia.
 */
import 'reflect-metadata';
import 'dotenv/config';

const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const COMBINADA = '(TNP/LI) CADASTRO PRODUTOS';

async function main() {
  const alvo = Number(process.argv[2] ?? 1198);
  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const { GoogleSheetsClient, a1, indexToCol } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();

  const abas = await c.getSheets(NOVA);
  console.log('=== ABAS ===');
  for (const a of abas) {
    if (/CADASTRO PRODUTOS|GRUPOS|FISCAL/i.test(a.title)) {
      console.log(`  ${a.title}  (${a.rowCount}x${a.columnCount})`);
    }
  }

  const meta = abas.find((a) => a.title === COMBINADA)!;
  const ate = indexToCol(meta.columnCount - 1);
  const [faixasL, cabsL, modelo, ref, atual] = await c.batchGetValues(NOVA, [
    a1(COMBINADA, `A3:${ate}3`),
    a1(COMBINADA, `A5:${ate}5`),
    a1(COMBINADA, `A12:${ate}12`),
    a1(COMBINADA, `A1197:${ate}1197`),
    a1(COMBINADA, `A${alvo}:${ate}${alvo}`),
  ], 'FORMULA');

  const faixas = (faixasL[0] ?? []) as string[];
  const cabs = (cabsL[0] ?? []) as string[];
  const rowModelo = (modelo[0] ?? []) as string[];
  const rowRef = (ref[0] ?? []) as string[];
  const rowAtual = (atual[0] ?? []) as string[];

  let faixaAtual = '';
  console.log(`\n=== ${COMBINADA} — col | faixa | cabecalho | modelo(l.12) | 1197 SNICKERS | ${alvo} ===`);
  for (let i = 0; i < cabs.length; i += 1) {
    if ((faixas[i] ?? '').trim()) faixaAtual = faixas[i]!.trim();
    const cab = (cabs[i] ?? '').replace(/\s+/g, ' ').trim();
    const m = (rowModelo[i] ?? '').slice(0, 46);
    const r = (rowRef[i] ?? '').slice(0, 22);
    const a = (rowAtual[i] ?? '').slice(0, 26);
    if (!cab && !m && !r && !a) continue;
    console.log(`${indexToCol(i).padEnd(3)}| ${faixaAtual.slice(0, 16).padEnd(16)}| ${cab.slice(0, 26).padEnd(26)}| ${m.padEnd(46)}| ${r.padEnd(22)}| ${a}`);
  }

  for (const abaLoja of ['(TNP) CADASTRO PRODUTOS', '(LI) CADASTRO PRODUTOS']) {
    const m2 = abas.find((a) => a.title === abaLoja);
    if (!m2) { console.log(`\n!! aba ${abaLoja} nao existe`); continue; }
    const ate2 = indexToCol(m2.columnCount - 1);
    const [f2, c2, l12, volta] = await c.batchGetValues(NOVA, [
      a1(abaLoja, `A3:${ate2}3`),
      a1(abaLoja, `A5:${ate2}5`),
      a1(abaLoja, `A12:${ate2}12`),
      a1(abaLoja, `A${alvo - 3}:${ate2}${alvo + 1}`),
    ], 'FORMULA');
    console.log(`\n=== ${abaLoja} (${m2.rowCount}x${m2.columnCount}) — col | faixa | cabecalho | linha 12 ===`);
    const fx = (f2[0] ?? []) as string[];
    const cb = (c2[0] ?? []) as string[];
    const r12 = (l12[0] ?? []) as string[];
    let fa = '';
    for (let i = 0; i < Math.max(cb.length, r12.length); i += 1) {
      if ((fx[i] ?? '').trim()) fa = fx[i]!.trim();
      const cab = (cb[i] ?? '').replace(/\s+/g, ' ').trim();
      const v = (r12[i] ?? '').slice(0, 60);
      if (!cab && !v) continue;
      console.log(`${indexToCol(i).padEnd(3)}| ${fa.slice(0, 14).padEnd(14)}| ${cab.slice(0, 26).padEnd(26)}| ${v}`);
    }
    console.log(`  --- linhas ${alvo - 3}..${alvo + 1} (primeiras 8 colunas com algo) ---`);
    ((volta ?? []) as string[][]).forEach((linha, k) => {
      const cheias = (linha ?? []).map((v, i) => [indexToCol(i), String(v ?? '')] as const)
        .filter(([, v]) => v.trim() !== '').slice(0, 8)
        .map(([col, v]) => `${col}=${v.slice(0, 30)}`);
      console.log(`   L${alvo - 3 + k}: ${cheias.join(' ') || '(vazia)'}`);
    });
  }
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
