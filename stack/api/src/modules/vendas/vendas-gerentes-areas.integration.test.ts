import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer;
let db: { execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>; $client: { end: () => Promise<void> } };
let sqlTag: typeof import('drizzle-orm')['sql'];
let servico: import('./vendas-gerentes-areas.service').VendasGerentesAreasService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  sqlTag = (await import('drizzle-orm')).sql;
  const database = await import('@/db/databases');
  db = database.db as unknown as typeof db;
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(database.db, { migrationsFolder: './drizzle' });
  const { VendasReportRepository } = await import('./vendas-report.repository');
  const { VendasGerentesAreasService } = await import('./vendas-gerentes-areas.service');
  servico = new VendasGerentesAreasService(new VendasReportRepository());
}, 300_000);

afterAll(async () => { await db?.$client.end(); await container?.stop(); });

async function produto(id: string, codigoInterno: string, area: string | null) {
  await db.execute(sqlTag`INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, codigo_interno, area_venda)
    VALUES (${id}, 'TNP', ${id}, ${id}, 'UN', 'revenda', ${codigoInterno}, ${area})`);
}
async function item(id: string, venda: string, codigo: string, total: number, hora: string, loja = 'TNP') {
  await db.execute(sqlTag`INSERT INTO venda_item_pdv (id, loja, venda_id_erp, item_id_erp, dispositivo_id_erp, pdv,
    vendido_em, produto_codigo, produto, quantidade, valor_unitario, total,
    item_cancelado, venda_status, venda_confirmada, origem_atualizada_em)
    VALUES (${id}, ${loja}, ${venda}, ${id}, '1', 'PDV 1', ${`2026-10-02T${hora}:00`}::timestamp,
      ${codigo}, ${id}, 1, ${total}, ${total}, false, 'CONFIRMADA', true, '2026-10-02T23:00:00'::timestamp)`);
}
async function vendaDia(id: string, codigo: string, total: number, loja = 'TNP') {
  await db.execute(sqlTag`INSERT INTO venda_produto_dia (id, loja, data, produto_codigo, produto,
    quantidade, valor_unitario, total, hash, origem_atualizada_em)
    VALUES (${id}, ${loja}, '2026-10-02'::date, ${codigo}, ${id}, 1, ${total}, ${total},
      ${id + '-hash'}, '2026-10-02T23:00:00'::timestamp)`);
}

describe('pontuação gerencial por área', () => {
  it('usa a área do produto, independente do PDV, preserva cobertura e sigilo', async () => {
    await produto('produto-chapa', '123', 'chapa');
    await produto('produto-sem-area', '124', null);
    await item('item-a', 'venda-1', '00000000000123', 20, '10:05');
    await item('item-b', 'venda-1', '00000000000124', 10, '10:05');
    await item('item-c', 'venda-2', '00000000000123', 40, '23:05');
    await item('item-outra-loja', 'venda-3', '00000000000123', 500, '10:05', 'LI');

    const pedido = { loja: 'TNP' as const, inicio: '2026-10-02', fim: '2026-10-02', granularidade: 'hora' as const };
    const r = await servico.relatorio(pedido, false);
    expect(r.categorias).toHaveLength(17);
    expect(r.categorias[0]).toBe('06h');
    expect(r.categorias[16]).toBe('22h');
    expect(r.totalPontos).toBe(7.5);
    expect(r.pontosSemArea).toBe(2.5);
    expect(r.pontosForaHorario).toBe(10);
    expect(r.produtosSemArea).toBe(1);
    expect(r.series).toHaveLength(1);
    expect(r.series[0]?.area).toBe('chapa');
    expect(r.series[0]?.pontos[0]).toMatchObject({ chave: '10h', pontos: 5, quantidade: 1, numeroVendas: 1, faturamento: null, ticketMedio: null });
    expect(JSON.stringify(r)).not.toContain('500');

    const admin = await servico.relatorio(pedido, true);
    expect(admin.series[0]?.pontos[0]).toMatchObject({ faturamento: 20, ticketMedio: 20 });

    await vendaDia('produto-chapa', '00000000000123', 80);
    await vendaDia('produto-sem-area', '00000000000124', 20);
    await vendaDia('produto-li', '00000000000123', 900, 'LI');
    const diario = await servico.relatorio({ ...pedido, granularidade: 'dia' }, false);
    expect(diario.origem).toBe('venda_produto_dia');
    expect(diario.totalPontos).toBe(25);
    expect(diario.pontosSemArea).toBe(5);
    expect(diario.series[0]?.pontos[0]).toMatchObject({ chave: '2026-10-02', pontos: 20, numeroVendas: null, ticketMedio: null, faturamento: null });
    expect(JSON.stringify(diario)).not.toContain('900');
  });
});
