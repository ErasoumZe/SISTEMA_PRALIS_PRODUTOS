import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env';
import {
  products, productTransformacao, productFiscal, promocoes,
} from '@/modules/product/product.table';
import { gruposMercadoria, locaisVenda, setores } from '@/modules/apoio/apoio.table';
import { users } from '@/modules/user/user.table';
import { productSheetSync } from '@/modules/google-sheets/product-sheet-sync.table';
import { sessions } from '@/modules/auth/auth.table';

const schema = {
  products,
  productTransformacao,
  productFiscal,
  promocoes,
  gruposMercadoria,
  locaisVenda,
  setores,
  users,
  sessions,
  productSheetSync,
};

const buildPoolConfig = (connectionString: string) => ({
  connectionString,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: env.PG_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.PG_CONN_TIMEOUT_MS,
});

export function createDbClient(connectionUrl?: string) {
  const pool = new Pool(buildPoolConfig(connectionUrl || env.DATABASE_URL));
  return drizzle(pool, { schema });
}

export const db = createDbClient();

export type DrizzleDB = typeof db;
export type DrizzleTransaction = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];
export type Tx = DrizzleDB | DrizzleTransaction;
