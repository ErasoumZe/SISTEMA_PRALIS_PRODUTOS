/**
 * Remove a fórmula intrusa da coluna `MARGEM PONTUAL %` da faixa LI.
 *
 * O PROBLEMA
 * ----------
 * `MARGEM PONTUAL %` é campo de ENTRADA: quem cadastra digita a margem daquele
 * produto. Prova disso é a faixa TNP, onde a mesma coluna (`AG`) tem **zero**
 * fórmulas em 9.920 linhas.
 *
 * Na faixa LI, `BW` tem 399 linhas com esta fórmula:
 *
 *   =IFERROR(VLOOKUP(AS<linha>;'(TNP/LI/HORA) CONFIGURAÇÕES - VLD SAIDA'!$I:$J;2;0);"")
 *
 * `AS` é coluna da PROMOÇÃO da TNP — é o mesmo deslocamento de 42 colunas que
 * estragou a fórmula de V. VENDA da LI. Sobra de copiar/colar, não regra.
 *
 * POR QUE ISSO TRAVA O CADASTRO
 * -----------------------------
 * O sistema não sobrescreve célula que contém fórmula: o cálculo é da planilha
 * e não se troca por valor congelado. Esse guarda está certo — mas aqui ele
 * protege lixo, e a margem digitada na tela nunca chega. Sem margem, a
 * V. VENDA sai igual ao custo.
 *
 * Limpar a célula devolve a coluna ao que ela é: entrada.
 *
 * Conferência por padrão; grava só com `--gravar`, com backup e `--restaurar`.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PRODUCAO = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';
const COLUNA = 'BW';
const PRIMEIRA = 11;
const ULTIMA = 9930;

/** A fórmula que não deveria estar ali. Só ela sai; valor digitado fica. */
const INTRUSA = /^=IFERROR\(VLOOKUP\(AS\d+;/;

async function main() {
  const gravar = process.argv.includes('--gravar');
  const restaurando = process.argv.includes('--restaurar');
  const arquivo = process.argv[process.argv.indexOf('--restaurar') + 1];

  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();
  const DOCS = resolve(process.cwd(), '../../docs');

  if (restaurando) {
    if (!arquivo) { console.error('uso: --restaurar <arquivo.json>'); process.exit(1); }
    const salvo = JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, string>;
    const valores = Object.entries(salvo).map(([celula, formula]) => ({
      range: a1(ABA, celula), values: [[formula]],
    }));
    for (let i = 0; i < valores.length; i += 500) {
      await c.batchUpdateValues(PRODUCAO, valores.slice(i, i + 500), 'USER_ENTERED');
    }
    console.log(`restauradas ${valores.length} células`);
    process.exit(0);
  }

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');

  const [lido] = await c.batchGetValues(
    PRODUCAO, [a1(ABA, `${COLUNA}${PRIMEIRA}:${COLUNA}${ULTIMA}`)], 'FORMULA',
  );
  const col = ((lido ?? []) as string[][]).map((r) => String(r?.[0] ?? ''));

  const alvo: Array<{ celula: string; formula: string }> = [];
  let comValor = 0;
  let outraFormula = 0;
  col.forEach((v, i) => {
    if (v === '') return;
    if (!v.startsWith('=')) { comValor += 1; return; }
    if (INTRUSA.test(v)) alvo.push({ celula: `${COLUNA}${PRIMEIRA + i}`, formula: v });
    else outraFormula += 1;
  });

  console.log(`\n  células com a fórmula intrusa : ${alvo.length}   <- vão virar vazias`);
  console.log(`  células com margem digitada   : ${comValor}   <- intocadas`);
  console.log(`  outras fórmulas               : ${outraFormula}   <- intocadas, não reconheci`);
  if (alvo.length) console.log(`\n  ex.: ${alvo[0]!.celula}  ${alvo[0]!.formula.slice(0, 100)}`);

  if (!gravar) { console.log('\n  (rode com --gravar para aplicar)'); process.exit(0); }
  if (alvo.length === 0) { console.log('\n  nada a fazer'); process.exit(0); }

  const backup = Object.fromEntries(alvo.map((a) => [a.celula, a.formula]));
  const destino = resolve(DOCS, `backup-margem-li-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(destino, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\n  backup: ${destino}`);

  const valores = alvo.map((a) => ({ range: a1(ABA, a.celula), values: [['']] }));
  for (let i = 0; i < valores.length; i += 500) {
    await c.batchUpdateValues(PRODUCAO, valores.slice(i, i + 500), 'USER_ENTERED');
    console.log(`  limpas ${Math.min(i + 500, valores.length)}/${valores.length}`);
  }
  console.log(`\n  pronto. Para desfazer: --restaurar ${destino}`);
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
