/**
 * Quando foi o ultimo registro de venda que chegou, por loja e por tipo.
 *
 * Existe para responder "o robo parou?" com data em vez de impressao. Olha as
 * DUAS fontes separadamente: venda por produto e fechamento de caixa chegam em
 * lotes diferentes, e uma pode parar sem a outra.
 *
 * `atualizado_em` e quando a LINHA entrou no banco; `data` e o dia da venda.
 * Os dois juntos distinguem "o robo parou de mandar" de "o robo manda, mas
 * manda dia velho".
 *
 * So leitura.
 */
import 'reflect-metadata';
import 'dotenv/config';

async function main() {
  const { db } = await import('@/db/databases');
  const { sql } = await import('drizzle-orm');

  for (const tabela of ['venda_produto_dia', 'fechamento_caixa_dia']) {
    console.log(`\n=== ${tabela} ===`);
    const r = (await db.execute(sql`
      SELECT loja,
             max(data)::text            AS ultimo_dia,
             max(atualizado_em)::text   AS ultima_chegada,
             count(*)::int              AS linhas
        FROM ${sql.raw(tabela)}
       GROUP BY loja ORDER BY loja
    `)).rows as Array<Record<string, unknown>>;

    if (!r.length) { console.log('  (vazia)'); continue; }
    for (const l of r) {
      console.log(`  ${String(l.loja).padEnd(5)} ultimo dia de venda: ${l.ultimo_dia}`
        + `  ·  ultima linha gravada: ${String(l.ultima_chegada).slice(0, 19)}`
        + `  ·  ${l.linhas} linhas`);
    }

    const dias = (await db.execute(sql`
      SELECT data::text AS dia, count(*)::int AS linhas
        FROM ${sql.raw(tabela)}
       GROUP BY data ORDER BY data DESC LIMIT 12
    `)).rows as Array<Record<string, unknown>>;
    console.log('  ultimos dias com registro:');
    for (const d of dias) console.log(`    ${d.dia}  ${String(d.linhas).padStart(6)} linha(s)`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
