/**
 * Atribui o código interno sequencial (00001, 00002...) aos produtos da BASE que ainda
 * não têm, e propaga o mesmo código para as cópias importadas nas lojas.
 * Idempotente: só preenche o que falta. Roda no start:prod (e pode rodar manualmente).
 *
 * Uso: npm run backfill:codigo
 */
import 'reflect-metadata';
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';

async function main() {
  // continua a numeração a partir do maior já atribuído (qualquer produto)
  const maxRes = await db.execute(
    sql`SELECT COALESCE(MAX(CAST(codigo_interno AS INTEGER)), 0) AS max FROM products WHERE codigo_interno ~ '^[0-9]+$'`,
  );
  let n = Number((maxRes.rows?.[0] as { max?: number | string } | undefined)?.max ?? 0);

  // 1) BASE sem código, em ordem de criação (mais antigo primeiro)
  const baseSem = await db.execute(
    sql`SELECT id FROM products WHERE loja = 'BASE' AND codigo_interno IS NULL ORDER BY created_at ASC, id ASC`,
  );
  const baseIds = (baseSem.rows ?? []) as { id: string }[];
  for (const r of baseIds) {
    n++;
    await db.execute(sql`UPDATE products SET codigo_interno = ${String(n).padStart(5, '0')} WHERE id = ${r.id}`);
  }

  // 2) propaga o código da base para as cópias importadas nas lojas
  await db.execute(sql`
    UPDATE products s
    SET codigo_interno = b.codigo_interno
    FROM products b
    WHERE s.base_product_id = b.id
      AND s.loja <> 'BASE'
      AND b.codigo_interno IS NOT NULL
      AND s.codigo_interno IS DISTINCT FROM b.codigo_interno`);

  // 3) produtos órfãos (criados direto na loja no modelo antigo, sem base) — recebem código próprio
  const orfaos = await db.execute(
    sql`SELECT id FROM products WHERE codigo_interno IS NULL ORDER BY created_at ASC, id ASC`,
  );
  const orfaoIds = (orfaos.rows ?? []) as { id: string }[];
  for (const r of orfaoIds) {
    n++;
    await db.execute(sql`UPDATE products SET codigo_interno = ${String(n).padStart(5, '0')} WHERE id = ${r.id}`);
  }

  console.log(`✅ Código interno: ${baseIds.length} da BASE + ${orfaoIds.length} órfão(s) numerados; propagado para as lojas.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Falha no backfill de código interno:', e);
  process.exit(1);
});
