/**
 * Aplica na aba fiscal o resultado de `estudo-fiscal.ts`.
 *
 * Lê `docs/fiscal-consolidado.tsv` — o confronto já resolvido — e grava na aba
 * fiscal SOMENTE as células que mudam. Casa por CÓDIGO, nunca por posição de
 * linha: a tabela é editada à mão e a ordem não é contrato.
 *
 * A regra que gerou o TSV está documentada em `estudo-fiscal.ts`:
 *  - NCM e CST pela maioria dos meses do estudo (classificação não muda
 *    sozinha; mês isolado que discorda é digitação);
 *  - % ICMS RE pelo mês mais recente (alíquota muda de verdade);
 *  - onde o estudo cala, mantém o que a planilha já tem.
 *
 * Conferência por padrão; grava só com `--gravar`. Antes de gravar, salva as
 * células atuais em `docs/backup-fiscal-<data>.json` — `--restaurar <arquivo>`
 * devolve exatamente o que estava lá.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PRODUCAO = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const PRIMEIRA_LINHA = 4;
const ULTIMA_LINHA = 2000;

/** Coluna da aba fiscal para cada campo do TSV. */
const COLUNA = { ncm: 'B', cst: 'C', icms: 'D', nome: 'E' } as const;

const texto = (v: unknown): string =>
  String(v ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();

const chaveCodigo = (v: unknown): string =>
  String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

async function main() {
  const gravar = process.argv.includes('--gravar');
  const restaurando = process.argv.includes('--restaurar');
  const arquivoRestauro = process.argv[process.argv.indexOf('--restaurar') + 1];

  const { env } = await import('@/config/env');
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();
  const aba = env.GOOGLE_SHEETS_FISCAL_TAB;
  const DOCS = resolve(process.cwd(), '../../docs');

  if (restaurando) {
    if (!arquivoRestauro) { console.error('uso: --restaurar <arquivo.json>'); process.exit(1); }
    const salvo = JSON.parse(readFileSync(arquivoRestauro, 'utf8')) as Record<string, string>;
    const valores = Object.entries(salvo).map(([celula, valor]) => ({
      range: a1(aba, celula), values: [[valor]],
    }));
    for (let i = 0; i < valores.length; i += 500) {
      await c.batchUpdateValues(PRODUCAO, valores.slice(i, i + 500), 'RAW');
    }
    console.log(`restauradas ${valores.length} células de ${arquivoRestauro}`);
    process.exit(0);
  }

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');

  // ---- o que a regra decidiu ----
  const tsv = readFileSync(resolve(DOCS, 'fiscal-consolidado.tsv'), 'utf8').replace(/^﻿/, '');
  const linhasTsv = tsv.split(/\r?\n/).filter((l) => l.trim() !== '');
  linhasTsv.shift(); // cabeçalho
  const decidido = new Map<string, { ncm: string; cst: string; icms: string; nome: string; origem: string }>();
  for (const l of linhasTsv) {
    const [codigo = '', ncm = '', cst = '', icms = '', nome = '', origem = ''] = l.split('\t');
    const chave = chaveCodigo(codigo);
    if (chave) decidido.set(chave, { ncm: texto(ncm), cst: texto(cst), icms: texto(icms), nome: texto(nome), origem: texto(origem) });
  }
  console.log(`\n  regra resolvida para ${decidido.size} códigos`);

  // ---- o que está na planilha ----
  const [atual] = await c.batchGetValues(
    PRODUCAO, [a1(aba, `A${PRIMEIRA_LINHA}:E${ULTIMA_LINHA}`)], 'FORMATTED_VALUE',
  );

  const mudancas: Array<{ celula: string; de: string; para: string; motivo: string }> = [];
  ((atual ?? []) as string[][]).forEach((r, i) => {
    const linha = PRIMEIRA_LINHA + i;
    const codigo = chaveCodigo(r?.[0]);
    if (!codigo) return;
    const alvo = decidido.get(codigo);
    if (!alvo) return;
    const naPlanilha = { ncm: texto(r?.[1]), cst: texto(r?.[2]), icms: texto(r?.[3]), nome: texto(r?.[4]) };
    for (const campo of ['ncm', 'cst', 'icms', 'nome'] as const) {
      const de = naPlanilha[campo];
      const para = alvo[campo];
      if (para === '' || para === de) continue;
      // nome só é escrito onde a planilha não tem nome de verdade
      if (campo === 'nome' && !de.toUpperCase().startsWith('(NAO VENDIDO')) continue;
      mudancas.push({
        celula: `${COLUNA[campo]}${linha}`,
        de,
        para,
        motivo: campo === 'nome' ? `nome (${codigo})` : `${campo.toUpperCase()} (${codigo})`,
      });
    }
  });

  const porTipo = new Map<string, number>();
  for (const m of mudancas) {
    const t = m.motivo.split(' ')[0]!;
    porTipo.set(t, (porTipo.get(t) ?? 0) + 1);
  }
  console.log(`\n  células a mudar: ${mudancas.length}`);
  for (const [t, n] of porTipo) console.log(`     ${t.padEnd(6)}: ${n}`);

  const naoNome = mudancas.filter((m) => !m.motivo.startsWith('nome'));
  if (naoNome.length) {
    console.log(`\n  --- mudanças de valor fiscal (todas) ---`);
    for (const m of naoNome) console.log(`     ${m.celula}  ${m.de || '(vazio)'}  ->  ${m.para}   ${m.motivo}`);
  }
  const nomes = mudancas.filter((m) => m.motivo.startsWith('nome'));
  if (nomes.length) {
    console.log(`\n  --- nomes preenchidos (3 primeiros de ${nomes.length}) ---`);
    for (const m of nomes.slice(0, 3)) console.log(`     ${m.celula}  ${m.de}  ->  ${m.para}`);
  }

  if (!gravar) { console.log('\n  (rode com --gravar para aplicar)'); process.exit(0); }
  if (mudancas.length === 0) { console.log('\n  nada a fazer'); process.exit(0); }

  const backup: Record<string, string> = {};
  for (const m of mudancas) backup[m.celula] = m.de;
  const arquivo = resolve(DOCS, `backup-fiscal-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(arquivo, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\n  backup do estado atual: ${arquivo}`);

  // RAW: NCM e código preservam zero à esquerda; nome é texto literal
  const valores = mudancas.map((m) => ({ range: a1(aba, m.celula), values: [[m.para]] }));
  for (let i = 0; i < valores.length; i += 500) {
    await c.batchUpdateValues(PRODUCAO, valores.slice(i, i + 500), 'RAW');
    console.log(`  gravadas ${Math.min(i + 500, valores.length)}/${valores.length}`);
  }
  console.log(`\n  pronto. Para desfazer: --restaurar ${arquivo}`);
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
