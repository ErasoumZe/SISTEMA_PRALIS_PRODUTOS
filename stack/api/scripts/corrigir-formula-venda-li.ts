/**
 * Repara a fórmula de V. VENDA da faixa LI na aba `(TNP/LI) CADASTRO PRODUTOS`.
 *
 * O PROBLEMA (medido em 10/09/2026)
 * ---------------------------------
 * A coluna AJ (V. VENDA da TNP) tem UMA única fórmula em 1.290 linhas:
 *
 *   =ROUND(IF(AI@="SIM";IF(D@="";0;IF(AG@="";(AF@*(AE@/J@))+(AE@/J@);
 *          IF(AG@<>"";(AG@*(AE@/J@))+(AE@/J@);0)));AH@);2)
 *
 * ou seja: venda = (CUSTO / QT) * (1 + margem). Divide pela quantidade da
 * embalagem, que é o que o sistema faz em `ProductRules.calcularVVenda`.
 *
 * A coluna BZ (V. VENDA da LI) tem DUAS fórmulas diferentes, e nenhuma certa:
 *
 *   1.047 linhas: ...(BU@/AZ@)...  -> divide por AZ, que é a coluna "QUI" da
 *                 promoção da TNP. É J deslocado em 42 colunas — a marca de um
 *                 copiar/colar do bloco da TNP em que as referências para
 *                 D (nome) e J (QT) andaram junto.
 *     242 linhas: ...(BV@*BU@)+BU@...  -> não divide por nada.
 *
 * Foi isso que fez o produto "teste ze" mostrar R$ 122,40 na planilha
 * (72 × 1,7) e R$ 10,20 no sistema (72 ÷ 12 × 1,7). O sistema estava certo.
 *
 * A CORREÇÃO
 * ----------
 * Não escrevo fórmula de cabeça: leio a fórmula da TNP na MESMA linha e troco
 * só as letras das colunas equivalentes. A LI passa a calcular exatamente como
 * a TNP, por construção. D (nome) e J (QT) ficam como estão — são colunas
 * gerais, compartilhadas pelas duas faixas.
 *
 * A linha 12 entra de propósito: é a linha-modelo de onde `garantirFormulas`
 * copia para toda linha nova. Deixá-la quebrada replicaria o defeito em cada
 * produto novo.
 *
 * SEGURANÇA
 * ---------
 * Conferência por padrão; grava só com `--gravar`. Antes de gravar, salva as
 * fórmulas atuais em `docs/backup-formula-bz-<data>.json` — é o rollback:
 * `--restaurar <arquivo>` devolve exatamente o que estava lá.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';
const PRIMEIRA = 11;
const ULTIMA = 9930;

/** Coluna da TNP -> coluna equivalente da LI. D (nome) e J (QT) são comuns. */
const EQUIVALENTE: Readonly<Record<string, string>> = {
  AI: 'BY', // AUTO
  AG: 'BW', // MARGEM PONTUAL %
  AF: 'BV', // MARGEM GRUPO %
  AE: 'BU', // CUSTO
  AH: 'BX', // V. VENDA PONTUAL
};

/** Troca só as referências de coluna listadas; o resto da fórmula é intocado. */
export const traduzirFormulaTnpParaLi = (formula: string): string =>
  formula.replace(/\b([A-Z]{1,2})(\d+)\b/g, (inteiro, coluna: string, linha: string) => {
    const destino = EQUIVALENTE[coluna];
    return destino ? `${destino}${linha}` : inteiro;
  });

async function main() {
  const gravar = process.argv.includes('--gravar');
  const restaurarDe = process.argv[process.argv.indexOf('--restaurar') + 1];
  const restaurando = process.argv.includes('--restaurar');

  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();
  const DOCS = resolve(process.cwd(), '../../docs');

  if (restaurando) {
    if (!restaurarDe) { console.error('uso: --restaurar <arquivo.json>'); process.exit(1); }
    const salvo = JSON.parse(readFileSync(restaurarDe, 'utf8')) as Record<string, string>;
    const valores = Object.entries(salvo).map(([celula, formula]) => ({
      range: a1(ABA, celula), values: [[formula]],
    }));
    console.log(`restaurando ${valores.length} celulas de ${restaurarDe}`);
    for (let i = 0; i < valores.length; i += 500) {
      await c.batchUpdateValues(NOVA, valores.slice(i, i + 500), 'USER_ENTERED');
      console.log(`  ${Math.min(i + 500, valores.length)}/${valores.length}`);
    }
    console.log('restaurado');
    process.exit(0);
  }

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');

  const [tnp, li] = await c.batchGetValues(NOVA, [
    a1(ABA, `AJ${PRIMEIRA}:AJ${ULTIMA}`),
    a1(ABA, `BZ${PRIMEIRA}:BZ${ULTIMA}`),
  ], 'FORMULA');

  const colTnp = ((tnp ?? []) as string[][]).map((r) => String(r?.[0] ?? ''));
  const colLi = ((li ?? []) as string[][]).map((r) => String(r?.[0] ?? ''));

  const backup: Record<string, string> = {};
  const escrever: Array<{ range: string; values: string[][] }> = [];
  let jaCerta = 0;
  let semTnp = 0;
  const amostra: string[] = [];

  for (let i = 0; i < colTnp.length; i += 1) {
    const linha = PRIMEIRA + i;
    const daTnp = colTnp[i] ?? '';
    if (!daTnp.startsWith('=')) { semTnp += 1; continue; }
    const desejada = traduzirFormulaTnpParaLi(daTnp);
    const atual = colLi[i] ?? '';
    if (atual === desejada) { jaCerta += 1; continue; }
    backup[`BZ${linha}`] = atual;
    escrever.push({ range: a1(ABA, `BZ${linha}`), values: [[desejada]] });
    if (amostra.length < 2) amostra.push(`  BZ${linha}\n    antes: ${atual}\n    depois: ${desejada}`);
  }

  console.log(`\n  linhas com formula na TNP : ${colTnp.filter((f) => f.startsWith('=')).length}`);
  console.log(`  linhas sem formula na TNP : ${semTnp} (nao mexo)`);
  console.log(`  LI ja igual a TNP         : ${jaCerta}`);
  console.log(`  LI a corrigir             : ${escrever.length}`);
  if (amostra.length) console.log(`\n${amostra.join('\n')}`);

  if (!gravar) { console.log('\n  (rode com --gravar para aplicar)'); process.exit(0); }
  if (escrever.length === 0) { console.log('\n  nada a fazer'); process.exit(0); }

  const arquivo = resolve(DOCS, `backup-formula-bz-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(arquivo, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\n  backup do estado atual: ${arquivo}`);

  for (let i = 0; i < escrever.length; i += 500) {
    await c.batchUpdateValues(NOVA, escrever.slice(i, i + 500), 'USER_ENTERED');
    console.log(`  gravadas ${Math.min(i + 500, escrever.length)}/${escrever.length}`);
  }
  console.log('\n  pronto. Para desfazer: --restaurar ' + arquivo);
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
