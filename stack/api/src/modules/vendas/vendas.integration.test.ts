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
let pdvService: import('./vendas-pdv.service').VendasPdvService;
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
  const { VendasPdvService } = await import('./vendas-pdv.service');
  const { VendasReportRepository } = await import('./vendas-report.repository');
  pdvService = new VendasPdvService(new VendasReportRepository());
}, 120000);

afterAll(async () => {
  await db?.$client?.end().catch(() => {});
  await container?.stop();
});

describe('ingestão de vendas e fechamentos (Postgres real)', () => {
  it('migra as tabelas com as chaves naturais e hashes únicos', async () => {
    const indexes = await db.execute(sqlTag`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('venda_produto_dia', 'fechamento_caixa_dia', 'venda_item_pdv')
    `);
    const names = indexes.rows.map((r) => r.indexname);
    expect(names).toContain('uq_venda_produto_dia_natural');
    expect(names).toContain('uq_venda_produto_dia_hash');
    expect(names).toContain('uq_fechamento_caixa_dia_natural');
    expect(names).toContain('uq_fechamento_caixa_dia_hash');
    expect(names).toContain('uq_venda_item_pdv_natural');
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

  it('guarda o vínculo original item → venda → dispositivo sem duplicar no reenvio', async () => {
    const item = {
      ID_VENDA_BALCAO: '101', ID_ITEM_VENDA_BALCAO: '501', ID_DISPOSITIVO: '7', PDV: 'PDV 07',
      DATA_HORA_VENDA: '2026-09-24 14:30:15', PRODUTO_ID_ERP: '99', PRODUTO_CODIGO: '7891',
      PRODUTO: 'PRODUTO TESTE', QUANTIDADE: '2', VALOR_UNITARIO: '5,00', TOTAL: '10,00',
      ITEM_CANCELADO: false, VENDA_STATUS: 'F', VENDA_CONFIRMADA: true, EMPRESA: 'TNP CENTRAL',
      ATUALIZADO_EM: '2026-09-24 14:31:00',
    };
    const lote = { tipo: 'venda_item_pdv' as const, linhas: [item] };
    expect(await service.importar(lote)).toEqual({ recebidas: 1, inseridas: 1, atualizadas: 0, ignoradas: 0 });
    expect(await service.importar(lote)).toEqual({ recebidas: 1, inseridas: 0, atualizadas: 0, ignoradas: 1 });
    expect(await service.importar({ ...lote, linhas: [{ ...item, TOTAL: '9,50', ATUALIZADO_EM: '2026-09-24 15:00:00' }] }))
      .toEqual({ recebidas: 1, inseridas: 0, atualizadas: 1, ignoradas: 0 });
    const rows = await db.execute(sqlTag`SELECT loja, venda_id_erp, item_id_erp, dispositivo_id_erp, total FROM venda_item_pdv`);
    expect(rows.rows).toEqual([{ loja: 'TNP', venda_id_erp: '101', item_id_erp: '501', dispositivo_id_erp: '7', total: '9.50' }]);
  });

  it('mostra somente itens não cancelados do dispositivo comprovado', async () => {
    await service.importar({ tipo: 'venda_item_pdv', linhas: [{
      ID_VENDA_BALCAO: '102', ID_ITEM_VENDA_BALCAO: '502', ID_DISPOSITIVO: '7', PDV: 'PDV 07',
      DATA_HORA_VENDA: '2026-09-24 14:31:15', PRODUTO_CODIGO: '7892', PRODUTO: 'CANCELADO',
      QUANTIDADE: '1', VALOR_UNITARIO: '100', TOTAL: '100', ITEM_CANCELADO: true,
      VENDA_STATUS: 'C', VENDA_CONFIRMADA: false, EMPRESA: 'TNP CENTRAL', ATUALIZADO_EM: '2026-09-24 14:32:00',
    }] });
    const query = { dispositivoIdErp: '7', inicio: '2026-09-24T14:30', fim: '2026-09-24T14:31', ordenar: 'quantidade' as const };
    const r = await pdvService.detalhe('TNP', query, true);
    expect(r).toMatchObject({ disponivel: true, quantidade: 2, numeroVendas: 1, faturamentoItens: 9.5, fechamento: null });
    expect(r.itens.map((i) => i.produto)).toEqual(['PRODUTO TESTE']);
    expect((await pdvService.detalhe('LI', query, true)).disponivel).toBe(false);
    const sigiloso = await pdvService.detalhe('TNP', query, false);
    expect(sigiloso.faturamentoItens).toBeNull();
    expect(sigiloso.itens[0]?.faturamento).toBeNull();
  });
});
