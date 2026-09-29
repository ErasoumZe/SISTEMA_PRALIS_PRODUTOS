/**
 * Reparacao idempotente apos drizzle-kit push. Em producao, o push cria a
 * coluna/tabela da migracao 0030, mas pode conservar o indice parcial antigo
 * (confirmado_em IS NULL), impedindo o segundo TXT mesmo apos a entrega.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { Pool, type PoolClient } from 'pg';

export async function ensureCreareDeliveryIndex(client: PoolClient): Promise<boolean> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('creare-delivery-schema'))");
    await client.query('LOCK TABLE creare_export_batch IN ACCESS EXCLUSIVE MODE');
    await client.query(`
      UPDATE creare_export_batch
      SET entregue_em = COALESCE(confirmado_em, cancelado_em)
      WHERE entregue_em IS NULL AND (confirmado_em IS NOT NULL OR cancelado_em IS NOT NULL)
    `);
    await client.query(`
      INSERT INTO creare_export_delivery_state (loja, product_id, hash, batch_id, entregue_em)
      SELECT loja, product_id, hash, batch_id, confirmado_em
      FROM creare_export_state
      WHERE true
      ON CONFLICT (loja, product_id) DO NOTHING
    `);

    const { rows } = await client.query<{ predicate: string | null }>(`
      SELECT pg_get_expr(i.indpred, i.indrelid) AS predicate
      FROM pg_class idx
      JOIN pg_index i ON i.indexrelid = idx.oid
      JOIN pg_class tbl ON tbl.oid = i.indrelid
      WHERE idx.relname = 'uq_creare_export_batch_aberto'
        AND tbl.relname = 'creare_export_batch'
    `);
    const predicate = rows[0]?.predicate?.toLowerCase() ?? '';
    const precisaRecriar = !predicate.includes('entregue_em')
      || !predicate.includes('confirmado_em') || !predicate.includes('cancelado_em');
    if (precisaRecriar) {
      await client.query('DROP INDEX IF EXISTS uq_creare_export_batch_aberto');
      await client.query(`
        CREATE UNIQUE INDEX uq_creare_export_batch_aberto ON creare_export_batch (loja)
        WHERE entregue_em IS NULL AND confirmado_em IS NULL AND cancelado_em IS NULL
      `);
    }
    await client.query('COMMIT');
    return precisaRecriar;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    try {
      const repaired = await ensureCreareDeliveryIndex(client);
      console.log(repaired ? 'Indice de entrega Criare corrigido.' : 'Indice de entrega Criare ja correto.');
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
