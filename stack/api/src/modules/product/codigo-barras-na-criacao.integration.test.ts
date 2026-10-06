import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductRepository } from './product.repository';

/**
 * O código interno nasce DENTRO da transação de `create` (F09), e é esse
 * número que precisa chegar ao campo de barras. Só o banco responde se isso
 * aconteceu: aqui se prova o caminho inteiro, não a função pura.
 *
 * ATENÇÃO: `@/db/databases` só por import dinâmico — ver nota nos outros testes.
 */
let container: StartedPostgreSqlContainer;
let repo: ProductRepository;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: {
    end: () => Promise<void>;
    on: (event: 'error', listener: (error: { code?: string }) => void) => void;
  };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

const payload = (extras: Record<string, unknown> = {}) => ({
  nome: 'PAO DE SAL',
  quantidade: 0,
  medidaBase: 'KG' as const,
  codigoBarras: null,
  marca: null,
  embalagem: null,
  cDe: null,
  qtCad: 1,
  medidaCompra: null,
  codigoInterno: null,
  fotoUrl: null,
  grupo: 'PADARIA',
  tipo: 'revenda' as const,
  status: 'ativo' as const,
  habilitarAjuda: false,
  estoqueMin: null,
  estoqueMax: null,
  setorEstoque: 'PROD. - PANIFICAÇÃO',
  setorVenda1: null,
  setorVenda2: null,
  custo: 1,
  margemPontual: null,
  vVendaPontual: 2,
  auto: false,
  localVenda1: null,
  localVenda2: null,
  promocoes: [],
  transformacao: null,
  fiscal: null,
  ...extras,
});

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });
  const { ProductRepository } = await import('./product.repository');
  repo = new ProductRepository();
}, 300_000);

afterAll(async () => {
  db.$client.on('error', (error) => {
    if (error.code !== '57P01') throw error;
  });
  await db.$client.end();
  await container.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM products`);
});

let seq = 0;
const criar = (extras: Record<string, unknown> = {}, ctx: Record<string, unknown> = {}) =>
  repo.create(payload(extras) as never, {
    loja: 'BASE', codigo: `PR-${++seq}`, createdByUserId: null, createdByName: 'Teste', ...ctx,
  } as never);

describe('código de barras na criação', () => {
  it('sem código de barras, o campo recebe o código interno GERADO', async () => {
    const p = await criar();

    expect(p.codigoInterno).toBeTruthy();
    expect(p.codigoBarras).toBe(p.codigoInterno);
    expect(await repo.findById(p.id)).toMatchObject({ codigoBarras: p.codigoInterno });
  });

  it('com código de barras, o EAN digitado fica — não é sobrescrito', async () => {
    const p = await criar({ codigoBarras: '7894900060010' });

    expect(p.codigoBarras).toBe('7894900060010');
    expect(p.codigoInterno).not.toBe('7894900060010');
  });

  it('dois produtos seguidos recebem códigos diferentes, e cada um o seu nas barras', async () => {
    const a = await criar();
    const b = await criar({ nome: 'BOLO DE CENOURA' });

    expect(a.codigoBarras).not.toBe(b.codigoBarras);
    expect(b.codigoBarras).toBe(b.codigoInterno);
  });

  /*
   * Importar da base herda o código interno da BASE (mesma numeração entre
   * lojas). O campo de barras da cópia tem que seguir o mesmo número, não um
   * novo — senão a loja e a base falariam de códigos diferentes.
   */
  it('quando o código interno vem de fora (importar da base), é esse que entra nas barras', async () => {
    const p = await criar({}, { codigoInterno: '12986', loja: 'TNP' });

    expect(p.codigoInterno).toBe('12986');
    expect(p.codigoBarras).toBe('12986');
  });

  it('código interno nulo vindo de fora não inventa barras', async () => {
    const p = await criar({}, { codigoInterno: null, loja: 'TNP' });

    expect(p.codigoInterno).toBeNull();
    expect(p.codigoBarras).toBeNull();
  });
});
