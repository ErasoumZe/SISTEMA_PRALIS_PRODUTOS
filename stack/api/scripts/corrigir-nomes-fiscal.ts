/**
 * Corrige a coluna `PRODUTO (nome no ERP)` da aba fiscal pelo nome do estudo.
 *
 * POR QUE
 * -------
 * A coluna E da aba fiscal diverge do estudo em 57 linhas, e não é só acento:
 * o código 11518 está lá como `HAMBURGUER` quando o estudo diz `FANTA UVA 2L`,
 * e o 11157 como `MISTO COM OVO` quando o estudo diz `EMPADA DE CAMARAO`.
 *
 * A coluna não entra em classificação nenhuma — o sistema casa por código e por
 * grupo. Mas ela é o que uma pessoa lê para conferir se a linha é do produto
 * certo, e nesse papel um nome errado é pior que nenhum: foi exatamente ela que
 * fez um casamento por nome pôr NCM de refrigerante em hambúrguer.
 *
 * O nome do estudo vence porque lá o código, o nome e o NCM estão na MESMA
 * linha do relatório do ERP — a origem é uma só. Na aba fiscal o nome foi
 * preenchido à parte.
 *
 * Diferença só de acentuação ou de espaço não é corrigida: mexer em 57 linhas
 * por causa de `PAO` vs `PÃO` é ruído, e o objetivo é a linha que aponta para
 * o produto errado.
 *
 * Conferência por padrão; grava só com `--gravar`, com backup e `--restaurar`.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PRODUCAO = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const PRIMEIRA_LINHA = 4;
const ULTIMA_LINHA = 2000;

const texto = (v: unknown): string =>
  String(v ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();

const chaveCodigo = (v: unknown): string =>
  String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/**
 * Chave para decidir se a diferença é só cosmética: sem acento, sem pontuação,
 * maiúscula. `PAO DE SAL` e `PÃO DE SAL` colapsam aqui e não viram correção.
 */
const semRuido = (v: unknown): string =>
  texto(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();

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
    const valores = Object.entries(salvo).map(([celula, valor]) => ({ range: a1(aba, celula), values: [[valor]] }));
    for (let i = 0; i < valores.length; i += 500) {
      await c.batchUpdateValues(PRODUCAO, valores.slice(i, i + 500), 'RAW');
    }
    console.log(`restauradas ${valores.length} células`);
    process.exit(0);
  }

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');

  // nome do estudo: 7ª coluna do TSV gerado por estudo-fiscal.ts
  const tsv = readFileSync(resolve(DOCS, 'fiscal-consolidado.tsv'), 'utf8').replace(/^﻿/, '');
  const linhasTsv = tsv.split(/\r?\n/).filter((l) => l.trim() !== '');
  linhasTsv.shift();
  const nomeDoEstudo = new Map<string, string>();
  for (const l of linhasTsv) {
    const partes = l.split('\t');
    const codigo = chaveCodigo(partes[0]);
    const nome = texto(partes[6]);
    if (codigo && nome) nomeDoEstudo.set(codigo, nome);
  }
  console.log(`\n  o estudo nomeia ${nomeDoEstudo.size} códigos`);

  const [atual] = await c.batchGetValues(
    PRODUCAO, [a1(aba, `A${PRIMEIRA_LINHA}:E${ULTIMA_LINHA}`)], 'FORMATTED_VALUE',
  );

  const mudancas: Array<{ celula: string; de: string; para: string }> = [];
  let soAcento = 0;
  ((atual ?? []) as string[][]).forEach((r, i) => {
    const linha = PRIMEIRA_LINHA + i;
    const codigo = chaveCodigo(r?.[0]);
    if (!codigo) return;
    const naPlanilha = texto(r?.[4]);
    const doEstudo = nomeDoEstudo.get(codigo);
    if (!doEstudo || !naPlanilha || naPlanilha === doEstudo) return;
    if (semRuido(naPlanilha) === semRuido(doEstudo)) { soAcento += 1; return; }
    mudancas.push({ celula: `E${linha}`, de: naPlanilha, para: doEstudo });
  });

  console.log(`  nomes que apontam para produto DIFERENTE: ${mudancas.length}`);
  console.log(`  diferenças só de acento/pontuação (não mexo): ${soAcento}`);
  console.log('');
  for (const m of mudancas) console.log(`     ${m.celula.padEnd(6)} "${m.de}"  ->  "${m.para}"`);

  if (!gravar) { console.log('\n  (rode com --gravar para aplicar)'); process.exit(0); }
  if (mudancas.length === 0) { console.log('\n  nada a fazer'); process.exit(0); }

  const backup: Record<string, string> = {};
  for (const m of mudancas) backup[m.celula] = m.de;
  const arquivo = resolve(DOCS, `backup-nomes-fiscal-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(arquivo, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\n  backup: ${arquivo}`);

  await c.batchUpdateValues(
    PRODUCAO, mudancas.map((m) => ({ range: a1(aba, m.celula), values: [[m.para]] })), 'RAW',
  );
  console.log(`  gravadas ${mudancas.length} células`);
  console.log(`\n  pronto. Para desfazer: --restaurar ${arquivo}`);
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
