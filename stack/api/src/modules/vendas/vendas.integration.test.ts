import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { VendasRepository } from './vendas.repository';
import type { VendasService } from './vendas.service';

type Fixture = {
  lotes: Array<{ tipo: 'venda_produto_dia' | 'fechamento_caixa_dia'; linhas: Record<string, unknown>[] }>;
};

let container: StartedPostgreSqlContainer;
let repository: VendasRepository;
let service: VendasService;
let db: { execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>; $client: { end: () => Promise<void> } };
let sqlTag: typeof import('drizzle-orm')['sql'];

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), '../../docs/superpowers/fixtures/2026-08-26-vendas-reais-anonimizadas.json'),
  'utf8',
)) as Fixture;
const loteVendas = fixture.lotes.find((l) => l.tipo === 'venda_produto_dia')!;
const loteFechamentos = fixture.lotes.find((l) => l.tipo === 'fechamento_caixa_dia')!;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const drizzle = await import('drizzle-orm');
  sqlTag = drizzle.sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });
  const { VendasRepository } = await import('./vendas.repository');
  const { VendasService } = await import('./vendas.service');
  repository = new VendasRepository();
  service = new VendasService(repository);
}, 120000);

afterAll(async () => {
  await db?.$client?.end().catch(() => {});
  await container?.stop();
});

describe('ingestão de vendas e fechamentos (Postgres real)', () => {
  it('migra as tabelas com as chaves naturais e hashes únicos', async () => {
    const indexes = await db.execute(sqlTag`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('venda_produto_dia', 'fechamento_caixa_dia')
    `);
    const names = indexes.rows.map((r) => r.indexname);
    expect(names).toContain('uq_venda_produto_dia_natural');
    expect(names).toContain('uq_venda_produto_dia_hash');
    expect(names).toContain('uq_fechamento_caixa_dia_natural');
    expect(names).toContain('uq_fechamento_caixa_dia_hash');
  });

  it('insere, corrige por chave natural e preserva produtos sem código pela descrição', async () => {
    const first = await service.importar(loteVendas);
    expect(first).toEqual({ recebidas: 6, inseridas: 5, atualizadas: 1, ignoradas: 0 });

    const rows = await db.execute(sqlTag`
      SELECT loja, data, produto_codigo, produto, quantidade, total
      FROM venda_produto_dia ORDER BY produto
    `);
    expect(rows.rows).toHaveLength(5);
    const corrected = rows.rows.find((r) => r.produto === 'PRODUTO EAN EXEMPLO 200ML');
    expect(corrected).toMatchObject({ loja: 'TNP', quantidade: '6.000', total: '32.70' });
    expect(rows.rows.filter((r) => r.produto_codigo === '')).toHaveLength(2);
  });

  it('reenvia o mesmo lote sem duplicar nem regredir a correção', async () => {
    const second = await service.importar(loteVendas);
    expect(second).toEqual({ recebidas: 6, inseridas: 0, atualizadas: 0, ignoradas: 6 });
    const rows = await db.execute(sqlTag`SELECT quantidade FROM venda_produto_dia WHERE produto = 'PRODUTO EAN EXEMPLO 200ML'`);
    expect(rows.rows[0]?.quantidade).toBe('6.000');
  });

  it('insere fechamentos e deriva posto/nominal no servidor', async () => {
    const result = await service.importar(loteFechamentos);
    expect(result).toEqual({ recebidas: 2, inseridas: 2, atualizadas: 0, ignoradas: 0 });
    const rows = await db.execute(sqlTag`
      SELECT loja, natureza, caixa, turno FROM fechamento_caixa_dia ORDER BY loja
    `);
    expect(rows.rows).toEqual([
      { loja: 'LI', natureza: 'nominal', caixa: null, turno: null },
      { loja: 'TNP', natureza: 'posto', caixa: '1', turno: 'M' },
    ]);
  });

  it('recusa HORA antes da transação e não grava parcialmente', async () => {
    const before = await db.execute(sqlTag`SELECT count(*)::int AS total FROM venda_produto_dia`);
    await expect(service.importar({
      tipo: 'venda_produto_dia',
      linhas: [loteVendas.linhas[0]!, { ...loteVendas.linhas[1]!, EMPRESA: 'HORA' }],
    })).rejects.toMatchObject({ code: 'SALES_BATCH_INVALID', statusCode: 422 });
    const after = await db.execute(sqlTag`SELECT count(*)::int AS total FROM venda_produto_dia`);
    expect(after.rows[0]?.total).toBe(before.rows[0]?.total);
  });
});

