/**
 * Auditoria SOMENTE LEITURA do estado fiscal depois do PR #38.
 *
 * Existe para revalidar, no dado, cada afirmação que orienta o desenho — em vez
 * de herdá-las de um relatório. Cada bloco responde uma pergunta que muda o
 * código se a resposta for outra.
 *
 * Não escreve em planilha nem em banco.
 */
import 'reflect-metadata';
import 'dotenv/config';

const PRODUCAO = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';
const ABA_ECF = '(TNP) FISCAL - CADASTRO ECF';
const PRIMEIRA = 11;

const texto = (v: unknown): string =>
  String(v ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();

const chave = (v: unknown): string => texto(v)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

async function main() {
  const { GoogleSheetsClient, a1, indexToCol } = await import('@/modules/google-sheets/google-sheets.client');
  const { env } = await import('@/config/env');
  const c = new GoogleSheetsClient();

  // ---------- 1. cabeçalhos da faixa fiscal ----------
  console.log('=== 1. FAIXA FISCAL: cabeçalhos e duplicidade ===');
  const [faixas, cabs] = await c.batchGetValues(
    PRODUCAO, [a1(ABA, 'A3:HW3'), a1(ABA, 'A5:HW5')], 'FORMATTED_VALUE',
  );
  const linha3 = ((faixas?.[0] ?? []) as string[]);
  const linha5 = ((cabs?.[0] ?? []) as string[]);
  let faixaAtual = '';
  const daFiscal: Array<{ col: string; nome: string }> = [];
  linha5.forEach((h, i) => {
    if (texto(linha3[i])) faixaAtual = texto(linha3[i]);
    if (faixaAtual.toUpperCase().includes('FISCAL') && texto(h)) {
      daFiscal.push({ col: indexToCol(i), nome: texto(h) });
    }
  });
  daFiscal.forEach((x) => console.log(`   ${x.col.padEnd(4)} ${x.nome}`));
  const repetidos = daFiscal
    .map((x) => x.nome)
    .filter((n, i, t) => t.indexOf(n) !== i);
  console.log(`   cabeçalhos REPETIDOS na faixa: ${[...new Set(repetidos)].join(', ') || '(nenhum)'}`);

  // ---------- 2. colunas da aba ECF ----------
  console.log('\n=== 2. ABA ECF: colunas A:Q e preenchimento ===');
  const [cabEcf] = await c.batchGetValues(PRODUCAO, [a1(ABA_ECF, 'A1:Q1')], 'FORMATTED_VALUE');
  const [corpoEcf] = await c.batchGetValues(PRODUCAO, [a1(ABA_ECF, 'A2:Q4000')], 'FORMATTED_VALUE');
  const nomesEcf = ((cabEcf?.[0] ?? []) as string[]);
  const linhasEcf = ((corpoEcf ?? []) as string[][]);
  nomesEcf.forEach((n, i) => {
    const preenchidas = linhasEcf.filter((l) => texto(l?.[i]) !== '').length;
    console.log(`   ${indexToCol(i).padEnd(3)} ${texto(n).slice(0, 24).padEnd(26)} ${String(preenchidas).padStart(5)} de ${linhasEcf.length}`);
  });

  // ---------- 3. nomes ambíguos na fonte ----------
  const porNome = new Map<string, number>();
  for (const l of linhasEcf) {
    const k = chave(l?.[1]);
    if (k) porNome.set(k, (porNome.get(k) ?? 0) + 1);
  }
  const ambiguos = [...porNome.entries()].filter(([, n]) => n > 1);
  console.log(`\n=== 3. NOMES AMBÍGUOS na fonte ECF: ${ambiguos.length} ===`);
  ambiguos.slice(0, 6).forEach(([n, q]) => console.log(`   ${q}x ${n}`));

  // ---------- 4. produtos da planilha x fonte ECF x grupos oficiais ----------
  const [nomes, grupos, gruposT] = await c.batchGetValues(
    PRODUCAO, [a1(ABA, `D${PRIMEIRA}:D1400`), a1(ABA, `M${PRIMEIRA}:M1400`), a1(ABA, `O${PRIMEIRA}:O1400`)],
    'FORMATTED_VALUE',
  );
  const col = (v: unknown) => ((v ?? []) as string[][]).map((r) => texto(r?.[0]));
  const N = col(nomes); const G = col(grupos); const GT = col(gruposT);

  // grupos oficiais: a tabela que o TaxRuleService lê
  const [regras] = await c.batchGetValues(
    PRODUCAO, [a1(env.GOOGLE_SHEETS_FISCAL_TAB, 'AB4:AG79')], 'FORMATTED_VALUE',
  );
  const oficiais = new Set(((regras ?? []) as string[][])
    .map((r) => chave(r?.[0])).filter(Boolean));
  console.log(`\n=== 4. GRUPOS: ${oficiais.size} regras oficiais ===`);

  const semRegra = new Map<string, number>();
  let comProduto = 0;
  let casaEcf = 0;
  let ecfAmbiguo = 0;
  const semCasar: string[] = [];
  for (let i = 0; i < N.length; i += 1) {
    if (!N[i]) continue;
    comProduto += 1;
    const g = G[i] || GT[i];
    if (g && !oficiais.has(chave(g))) semRegra.set(g, (semRegra.get(g) ?? 0) + 1);
    const q = porNome.get(chave(N[i])) ?? 0;
    if (q === 1) casaEcf += 1;
    else if (q > 1) ecfAmbiguo += 1;
    else if (semCasar.length < 8) semCasar.push(N[i]!);
  }
  console.log(`   produtos na aba            : ${comProduto}`);
  console.log(`   grupos gravados SEM regra  : ${[...semRegra.values()].reduce((a, b) => a + b, 0)} produtos, ${semRegra.size} grupos distintos`);
  [...semRegra.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .forEach(([g, n]) => console.log(`      ${String(n).padStart(4)}x "${g}"`));
  console.log(`   casam no ECF por nome único: ${casaEcf}`);
  console.log(`   nome ambíguo no ECF        : ${ecfAmbiguo}`);
  console.log(`   sem casar                  : ${comProduto - casaEcf - ecfAmbiguo}`);
  console.log(`      ex.: ${semCasar.slice(0, 5).join(' | ')}`);

  // ---------- 5. conflito CST: grupo x fonte ECF ----------
  console.log('\n=== 5. CONFLITO de CST (regra do grupo x linha do ECF) ===');
  const cstDoGrupo = new Map<string, string>();
  for (const r of ((regras ?? []) as string[][])) {
    const k = chave(r?.[0]);
    if (k && texto(r?.[1])) cstDoGrupo.set(k, texto(r[1]));
  }
  const cstDoEcf = new Map<string, string>();
  for (const l of linhasEcf) {
    const k = chave(l?.[1]);
    if (k && (porNome.get(k) ?? 0) === 1) cstDoEcf.set(k, texto(l?.[7]));
  }
  let conflitos = 0;
  const exemplos: string[] = [];
  for (let i = 0; i < N.length; i += 1) {
    if (!N[i]) continue;
    const g = G[i] || GT[i];
    const doGrupo = cstDoGrupo.get(chave(g));
    const doEcf = cstDoEcf.get(chave(N[i]));
    if (doGrupo && doEcf && doGrupo !== doEcf) {
      conflitos += 1;
      if (exemplos.length < 5) exemplos.push(`   ${N[i]}: grupo diz ${doGrupo}, ECF diz ${doEcf}`);
    }
  }
  console.log(`   produtos com CST divergente: ${conflitos}`);
  exemplos.forEach((e) => console.log(e));
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
