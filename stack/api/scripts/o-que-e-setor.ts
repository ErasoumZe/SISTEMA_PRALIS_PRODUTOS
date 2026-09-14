/**
 * O que existe HOJE em cada campo que poderia ser "setor".
 *
 * Existe para responder uma pergunta de negócio com dado em vez de palpite:
 * quando o José fala em "produção, padaria, confeitaria", qual coluna do
 * cadastro já guarda isso? São três candidatas, e elas têm preenchimentos bem
 * diferentes — escolher a errada faz metade do faturamento cair em "sem
 * classificação" e o ranking de bonificação nascer torto.
 *
 * Mostra, para cada candidata: quantos produtos têm valor, quantos valores
 * distintos, e os valores mais usados.
 *
 * Só leitura.
 *
 * Uso: tsx scripts/o-que-e-setor.ts
 */
import 'reflect-metadata';
import 'dotenv/config';

async function main() {
  const { db } = await import('@/db/databases');
  const { sql } = await import('drizzle-orm');

  const [{ total } = { total: 0 }] = (await db.execute(
    sql`SELECT count(*)::int AS total FROM products WHERE status <> 'unificado'`,
  )).rows as Array<{ total: number }>;
  console.log(`produtos no catalogo: ${total}\n`);

  const CANDIDATAS = [
    { coluna: 'grupo', rotulo: 'grupo (GRUPO MERCADORIAS)' },
    { coluna: 'setor_venda_1', rotulo: 'setorVenda1 (onde o produto E VENDIDO)' },
    { coluna: 'setor_venda_2', rotulo: 'setorVenda2 (segundo ponto de venda)' },
    { coluna: 'setor_estoque', rotulo: 'setorEstoque (onde fica guardado)' },
  ];

  for (const c of CANDIDATAS) {
    const preenchidos = (await db.execute(sql`
      SELECT count(*)::int AS n
      FROM products
      WHERE status <> 'unificado'
        AND ${sql.raw(`"${c.coluna}"`)} IS NOT NULL
        AND btrim(${sql.raw(`"${c.coluna}"`)}) <> ''
    `)).rows as Array<{ n: number }>;

    const distintos = (await db.execute(sql`
      SELECT ${sql.raw(`"${c.coluna}"`)} AS valor, count(*)::int AS n
      FROM products
      WHERE status <> 'unificado'
        AND ${sql.raw(`"${c.coluna}"`)} IS NOT NULL
        AND btrim(${sql.raw(`"${c.coluna}"`)}) <> ''
      GROUP BY 1
      ORDER BY 2 DESC
    `)).rows as Array<{ valor: string; n: number }>;

    const n = preenchidos[0]?.n ?? 0;
    const cobertura = total ? ((n / total) * 100).toFixed(1) : '0';
    console.log(`=== ${c.rotulo} ===`);
    console.log(`  preenchido em ${n} de ${total} produtos (${cobertura}%) · ${distintos.length} valores distintos`);
    for (const d of distintos.slice(0, 12)) {
      console.log(`    ${String(d.n).padStart(5)}  ${d.valor}`);
    }
    if (distintos.length > 12) console.log(`    ... e mais ${distintos.length - 12} valor(es)`);
    console.log('');
  }

  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
