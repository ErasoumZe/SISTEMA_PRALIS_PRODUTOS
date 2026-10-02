import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductRepository } from './product.repository';

/** ATENÇÃO: `@/db/databases` só por import dinâmico — ver nota nos outros testes. */
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
  /*
   * O Pool pode receber o 57P01 no intervalo entre `end()` e a parada do
   * container. É o encerramento normal do Postgres de teste, não uma falha da
   * regra exercitada. Outros erros continuam sendo lançados para não mascarar
   * uma conexão inválida.
   */
  db.$client.on('error', (error) => {
    if (error.code !== '57P01') throw error;
  });
  await db.$client.end();
  await container.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM products`);
});

const criar = (extras: Record<string, unknown> = {}) =>
  repo.create(payload(extras) as never, {
    loja: 'BASE', codigo: 'PR-1', createdByUserId: null, createdByName: 'Teste',
  });

describe('local e setor de venda (primário e secundário)', () => {
  it('grava e devolve os quatro campos', async () => {
    const p = await criar({
      localVenda1: 'VITRINE FRENTE',
      localVenda2: 'BALCAO CAIXA',
      setorVenda1: 'PADARIA',
      setorVenda2: 'CONVENIENCIA',
    });

    const lido = await repo.findById(p.id);

    expect(lido).toMatchObject({
      localVenda1: 'VITRINE FRENTE',
      localVenda2: 'BALCAO CAIXA',
      setorVenda1: 'PADARIA',
      setorVenda2: 'CONVENIENCIA',
    });
  });

  it('aceita nulo — os quatro sao opcionais', async () => {
    const p = await criar();

    expect(await repo.findById(p.id)).toMatchObject({
      localVenda1: null, localVenda2: null, setorVenda1: null, setorVenda2: null,
    });
  });

  /* Setor de VENDA e setor de ESTOQUE sao colunas diferentes e coexistem. */
  it('setor de venda NAO se mistura com setor de estoque', async () => {
    const p = await criar({ setorVenda1: 'PADARIA' });

    const r = await db.execute(sqlTag`
      SELECT setor_estoque, setor_venda_1 FROM products WHERE id = ${p.id}`);

    expect(r.rows[0]).toMatchObject({
      setor_estoque: 'PROD. - PANIFICAÇÃO',
      setor_venda_1: 'PADARIA',
    });
  });

  it('a edicao troca so o que foi mandado', async () => {
    const p = await criar({ setorVenda1: 'PADARIA', localVenda1: 'VITRINE' });

    await repo.update(p.id, { setorVenda1: 'CONFEITARIA' });

    expect(await repo.findById(p.id)).toMatchObject({
      setorVenda1: 'CONFEITARIA',
      localVenda1: 'VITRINE', // não foi mandado: continua como estava
    });
  });

  it('grava a area fisica da TNP separada dos setores de venda e estoque', async () => {
    const p = await repo.create(payload({ areaVenda: 'chapa', setorVenda1: 'PADARIA' }) as never, {
      loja: 'TNP', codigo: 'PR-AREA', createdByUserId: null, createdByName: 'Teste',
    });
    expect(await repo.findById(p.id)).toMatchObject({ areaVenda: 'chapa', setorVenda1: 'PADARIA' });
    await repo.update(p.id, { areaVenda: 'vitrine' });
    const r = await db.execute(sqlTag`SELECT area_venda, setor_venda_1 FROM products WHERE id = ${p.id}`);
    expect(r.rows[0]).toMatchObject({ area_venda: 'vitrine', setor_venda_1: 'PADARIA' });
  });
});
