import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer;
let servico: import('./vendas-gerentes.service').VendasGerentesService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  sqlTag = (await import('drizzle-orm')).sql;
  const database = await import('@/db/databases');
  db = database.db as unknown as typeof db;
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(database.db, { migrationsFolder: './drizzle' });
  const { VendasGerentesService } = await import('./vendas-gerentes.service');
  servico = new VendasGerentesService();
}, 300_000);

afterAll(async () => {
  await db?.$client.end();
  await container?.stop();
});

async function fechamento(loja: string, data: string, pdv: string, operador: string, total: number, dispositivoIdErp = '') {
  await db.execute(sqlTag`
    INSERT INTO fechamento_caixa_dia (id, loja, data, pdv, dispositivo_id_erp, operador, natureza,
      primeira_venda, ultima_venda, numero_vendas, total_pagamento, hash, origem_atualizada_em)
    VALUES (gen_random_uuid()::text, ${loja}, ${data}::date, ${pdv}, ${dispositivoIdErp}, ${operador}, 'VENDA',
      ${`${data}T08:00:00Z`}, ${`${data}T18:00:00Z`}, 1, ${total},
      ${`${loja}-${data}-${pdv}-${operador}`}, ${`${data}T19:00:00Z`})
  `);
}

async function item(loja: string, dispositivoIdErp: string, vendaId: string, quantidade: number) {
  await db.execute(sqlTag`
    INSERT INTO venda_item_pdv (id, loja, venda_id_erp, item_id_erp, dispositivo_id_erp, pdv,
      vendido_em, produto_id_erp, produto_codigo, produto, quantidade, valor_unitario,
      total, item_cancelado, venda_status, venda_confirmada, origem_atualizada_em)
    VALUES (gen_random_uuid()::text, ${loja}, ${vendaId}, ${vendaId + '-item'}, ${dispositivoIdErp}, 'PDV',
      '2026-10-01T10:00:00'::timestamp, 'produto-1', '1', 'PRODUTO', ${quantidade}, 10,
      ${quantidade * 10}, false, 'CONFIRMADA', true, '2026-10-01T19:00:00'::timestamp)
  `);
}

describe('relatório gerentes contra o fechamento real', () => {
  it('agrupa operadores por PDV, mantém dias sem dado e isola a loja', async () => {
    await fechamento('TNP', '2026-10-01', 'PDV 1', 'ANA', 100, '7');
    await fechamento('TNP', '2026-10-01', 'PDV 1', 'JOAO', 20, '7');
    await fechamento('TNP', '2026-10-03', 'PDV 2', 'ANA', 80, '8');
    await fechamento('TNP', '2026-10-03', ' ', 'SEM PDV', 500);
    await fechamento('LI', '2026-10-01', 'PDV 9', 'ANA', 1000, '9');
    await item('TNP', '7', 'venda-1', 3.5);
    await item('LI', '9', 'venda-9', 99);

    const r = await servico.relatorio('TNP', { inicio: '2026-10-01', fim: '2026-10-03' });
    expect(r.pdvs).toEqual(['PDV 1', 'PDV 2']);
    expect(r.totalPontos).toBe(50);
    expect(r.series[0]?.dias).toEqual([
      { data: '2026-10-01', pontos: 30, faturamento: null, numeroVendas: 2, ticketMedio: null, quantidade: 3.5, vendasComItens: 1 },
      { data: '2026-10-02', pontos: null, faturamento: null, numeroVendas: null, ticketMedio: null, quantidade: null, vendasComItens: null },
      { data: '2026-10-03', pontos: null, faturamento: null, numeroVendas: null, ticketMedio: null, quantidade: null, vendasComItens: null },
    ]);
    expect(r.series[1]?.dias[2]?.pontos).toBe(20);
    expect(JSON.stringify(r)).not.toContain('1000');
    expect(JSON.stringify(r)).not.toContain('99');

    const admin = await servico.relatorio('TNP', { inicio: '2026-10-01', fim: '2026-10-03' }, true);
    expect(admin.series[0]?.dias[0]).toMatchObject({ faturamento: 120, ticketMedio: 60, quantidade: 3.5 });

    const filtrado = await servico.relatorio('TNP', { inicio: '2026-10-01', fim: '2026-10-03', pdv: 'PDV 2' });
    expect(filtrado.series).toHaveLength(1);
    expect(filtrado.totalPontos).toBe(20);

    const soDiaUm = await servico.relatorio('TNP', { inicio: '2026-10-01', fim: '2026-10-01' });
    expect(soDiaUm.pdvs).toEqual(['PDV 1']);
    expect(soDiaUm.series).toHaveLength(1);
  });
});
