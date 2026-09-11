/**
 * Lista as decisões de grupo que faltam — uma folha para o administrador.
 *
 * Cruza os produtos cadastrados com as 76 regras oficiais e imprime, produto a
 * produto, quem está com grupo legado e quais grupos oficiais existem que
 * COMEÇAM pelo mesmo assunto.
 *
 * Os candidatos são só uma lista para olhar, NÃO uma sugestão: `SORVETES`
 * aparece com POTES e PICOLÉS lado a lado porque os dois existem e têm
 * tributação diferente. Quem escolhe é quem responde pelo imposto.
 *
 * A decisão vira uma linha em `src/modules/apoio/grupos-legados.ts`, e só entra
 * em vigor quando o backfill rodar com `--apply`.
 *
 * Só leitura. Não grava nada, em lugar nenhum.
 *
 * Uso: tsx scripts/grupos-legados.ts
 */
import 'reflect-metadata';
import 'dotenv/config';

/** As palavras que identificam o assunto do grupo, para juntar candidatos. */
const assunto = (grupo: string): string[] => grupo
  .toUpperCase()
  .replace(/^MER\s+/, '')
  .split(/[^A-ZÀ-Ú]+/)
  .filter((p) => p.length >= 4);

async function main() {
  const { container } = await import('tsyringe');
  const { TaxRuleService, normalizeGroup } = await import('@/modules/apoio/tax-rule.service');
  const { GRUPOS_LEGADOS, grupoOficialDe } = await import('@/modules/apoio/grupos-legados');
  const { db } = await import('@/db/databases');
  const { products } = await import('@/modules/product/product.table');
  const { ne } = await import('drizzle-orm');

  const regras = await container.resolve(TaxRuleService).list();
  const oficiais = new Set(regras.map((r) => normalizeGroup(r.grupo)));
  console.log(`regras oficiais carregadas: ${regras.length}`);
  console.log(`equivalencias ja decididas: ${Object.keys(GRUPOS_LEGADOS).length}\n`);

  const linhas = await db
    .select({ id: products.id, nome: products.nome, grupo: products.grupo, loja: products.loja })
    .from(products)
    .where(ne(products.status, 'unificado'));

  /** grupo legado -> produtos que estão nele */
  const pendentes = new Map<string, Array<{ nome: string; loja: string }>>();
  for (const p of linhas) {
    const g = p.grupo?.trim();
    if (!g) continue;
    if (oficiais.has(normalizeGroup(g))) continue;
    if (grupoOficialDe(g)) continue; // ja decidido
    const lista = pendentes.get(g) ?? [];
    lista.push({ nome: p.nome, loja: p.loja });
    pendentes.set(g, lista);
  }

  if (!pendentes.size) {
    console.log('Nenhum grupo legado pendente. Nada a decidir.');
    process.exit(0);
  }

  const total = [...pendentes.values()].reduce((s, l) => s + l.length, 0);
  console.log(`${pendentes.size} grupos legados, ${total} produtos:\n`);

  const ordenados = [...pendentes.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [legado, lista] of ordenados) {
    const palavras = assunto(legado);
    const candidatos = regras
      .map((r) => r.grupo)
      .filter((oficial) => palavras.some((p) => oficial.toUpperCase().includes(p)));

    console.log(`  ${legado}  (${lista.length} produto${lista.length > 1 ? 's' : ''})`);
    for (const p of lista) console.log(`      - ${p.nome}  [${p.loja}]`);
    if (candidatos.length) {
      console.log('    grupos oficiais que mencionam o mesmo assunto:');
      for (const c of candidatos) console.log(`      * ${c}`);
    } else {
      console.log('    nenhum grupo oficial menciona este assunto — escolher da lista inteira');
    }
    console.log(`    para decidir, acrescente em src/modules/apoio/grupos-legados.ts:`);
    console.log(`      '${legado.toUpperCase()}': { oficial: '...', decidido: 'AAAA-MM-DD', por: '...' },`);
    console.log('');
  }

  console.log('Nada foi gravado. A decisao entra por arquivo versionado, no PR.');
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
