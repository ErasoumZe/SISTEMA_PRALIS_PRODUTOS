import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { VendasGerentesPeriodo } from '@pralis/shared';

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

/** Item de venda em qualquer data — o helper acima fixa 01/10. */
async function itemEm(loja: string, data: string, dispositivoIdErp: string, pdv: string, vendaId: string, quantidade: number, total: number) {
  await db.execute(sqlTag`
    INSERT INTO venda_item_pdv (id, loja, venda_id_erp, item_id_erp, dispositivo_id_erp, pdv,
      vendido_em, produto_id_erp, produto_codigo, produto, quantidade, valor_unitario,
      total, item_cancelado, venda_status, venda_confirmada, origem_atualizada_em)
    VALUES (gen_random_uuid()::text, ${loja}, ${vendaId}, ${vendaId + '-item'}, ${dispositivoIdErp}, ${pdv},
      ${`${data}T10:00:00`}::timestamp, 'produto-1', '1', 'PRODUTO', ${quantidade}, 10,
      ${total}, false, 'CONFIRMADA', true, ${`${data}T10:05:00`}::timestamp)
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
      { data: '2026-10-01', pontos: 30, faturamento: null, numeroVendas: 2, ticketMedio: null, quantidade: 3.5, vendasComItens: 1, parcial: false },
      { data: '2026-10-02', pontos: null, faturamento: null, numeroVendas: null, ticketMedio: null, quantidade: null, vendasComItens: null, parcial: false },
      { data: '2026-10-03', pontos: null, faturamento: null, numeroVendas: null, ticketMedio: null, quantidade: null, vendasComItens: null, parcial: false },
    ]);
    // período no passado: nada ao vivo
    expect(r.diaAoVivo).toBeNull();
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

    const horas = await servico.relatorioHoras('TNP', { data: '2026-10-01' });
    expect(horas.origem).toBe('venda_item_pdv');
    expect(horas.horas).toHaveLength(17);
    expect(horas.pdvs).toEqual(['PDV']);
    expect(horas.series[0]?.horas[0]).toMatchObject({ hora: '10h', pontos: 8.75, quantidade: 3.5, numeroVendas: 1, faturamento: null });
    expect(JSON.stringify(horas)).not.toContain('990');
    const horasAdmin = await servico.relatorioHoras('TNP', { data: '2026-10-01' }, true);
    expect(horasAdmin.series[0]?.horas[0]).toMatchObject({ faturamento: 35, ticketMedio: 35 });
  });

  /*
   * O DIA EM CURSO (decisão do José em 06/10/2026). Sem fechamento, hoje era
   * um buraco no gráfico até o caixa fechar. Aqui se prova o caminho inteiro:
   * a venda ao vivo vira ponto, o dia sai marcado como parcial, e o PDV que só
   * existe hoje aparece na lista.
   */
  it('traz o dia em curso das vendas ao vivo, marcado como parcial', async () => {
    const hoje = VendasGerentesPeriodo.hojeSaoPaulo();
    await itemEm('TNP', hoje, '11', 'PDV AO VIVO', 'venda-hoje', 2, 200);

    const r = await servico.relatorio('TNP', { inicio: hoje, fim: hoje }, true);

    expect(r.diaAoVivo).toBe(hoje);
    expect(r.pdvs).toContain('PDV AO VIVO');
    const serie = r.series.find((s) => s.pdv === 'PDV AO VIVO');
    expect(serie?.dias[0]).toMatchObject({
      data: hoje, pontos: 50, faturamento: 200, numeroVendas: 1, parcial: true, quantidade: 2,
    });
  });

  it('havendo fechamento do dia, o fechamento manda e o dia deixa de ser parcial', async () => {
    const hoje = VendasGerentesPeriodo.hojeSaoPaulo();
    await itemEm('LI', hoje, '12', 'PDV LI', 'venda-li-hoje', 1, 400);
    await fechamento('LI', hoje, 'PDV LI', 'ANA', 100, '12');

    const r = await servico.relatorio('LI', { inicio: hoje, fim: hoje }, true);

    expect(r.diaAoVivo).toBeNull();
    // 100 do fechamento, não 400 dos itens
    expect(r.series[0]?.dias[0]).toMatchObject({ pontos: 25, faturamento: 100, parcial: false });
  });
});
