import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { ensureCreareDeliveryIndex } from './ensure-creare-delivery-index';

let container: StartedPostgreSqlContainer;
let pool: Pool;
let client: PoolClient;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  client = await pool.connect();
  await client.query(`
    CREATE TABLE creare_export_batch (
      id text PRIMARY KEY, loja text NOT NULL, confirmado_em timestamptz,
      cancelado_em timestamptz, entregue_em timestamptz
    );
    CREATE TABLE creare_export_state (
      loja text NOT NULL, product_id text NOT NULL, hash text NOT NULL,
      batch_id text NOT NULL, confirmado_em timestamptz NOT NULL,
      PRIMARY KEY (loja, product_id)
    );
    CREATE TABLE creare_export_delivery_state (
      loja text NOT NULL, product_id text NOT NULL, hash text NOT NULL,
      batch_id text NOT NULL, entregue_em timestamptz NOT NULL,
      PRIMARY KEY (loja, product_id)
    );
    CREATE UNIQUE INDEX uq_creare_export_batch_aberto ON creare_export_batch (loja)
      WHERE confirmado_em IS NULL AND cancelado_em IS NULL;
    INSERT INTO creare_export_batch (id, loja, confirmado_em)
      VALUES ('confirmado', 'TNP', now());
    INSERT INTO creare_export_batch (id, loja)
      VALUES ('aberto', 'TNP');
    INSERT INTO creare_export_state (loja, product_id, hash, batch_id, confirmado_em)
      VALUES ('TNP', 'produto-antigo', 'hash-antigo', 'confirmado', now());
  `);
});

afterAll(async () => {
  client?.release();
  await pool?.end();
  await container?.stop();
});

describe('reparo do indice de entrega no startup', () => {
  it('preserva confirmados, repara indice antigo e permite lote seguinte', async () => {
    expect(await ensureCreareDeliveryIndex(client)).toBe(true);
    expect(await ensureCreareDeliveryIndex(client)).toBe(false);
    const delivered = await client.query<{ hash: string }>(`
      SELECT hash FROM creare_export_delivery_state WHERE product_id = 'produto-antigo'
    `);
    expect(delivered.rows[0]?.hash).toBe('hash-antigo');
    const oldBatch = await client.query<{ entregue_em: Date | null }>(`
      SELECT entregue_em FROM creare_export_batch WHERE id = 'confirmado'
    `);
    expect(oldBatch.rows[0]?.entregue_em).not.toBeNull();
    await client.query("UPDATE creare_export_batch SET entregue_em = now() WHERE id = 'aberto'");
    await expect(client.query("INSERT INTO creare_export_batch (id, loja) VALUES ('proximo', 'TNP')"))
      .resolves.toBeDefined();
  });
});
