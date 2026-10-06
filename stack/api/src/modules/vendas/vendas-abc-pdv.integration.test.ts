import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { VendasAbcService } from './vendas-abc.service';

/**
 * O FILTRO DE PDV DA CURVA ABC ACEITA OS DOIS NOMES DO MESMO CAIXA.
 *
 * O Relatório de vendas manda o `dispositivo_id_erp` (é o que o seletor dele
 * carrega); o Relatório Gerentes só tem o NOME do caixa, porque o gráfico dele
 * vem do fechamento, onde a coluna é o nome. Enquanto a consulta casava só
 * pelo id, clicar num PDV no Relatório Gerentes abria uma lista vazia sem
 * dizer por quê — José, 06/10/2026.
 *
 * ATENÇÃO: `@/db/databases` só por import dinâmico — ver nota nos outros testes.
 */
let container: StartedPostgreSqlContainer;
let servico: VendasAbcService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

const DIA = '2026-10-02';

async function item(pdv: string, dispositivoIdErp: string, produto: string, total: number, vendaId: string) {
  await db.execute(sqlTag`
    INSERT INTO venda_item_pdv (id, loja, venda_id_erp, item_id_erp, dispositivo_id_erp, pdv,
      vendido_em, produto_id_erp, produto_codigo, produto, quantidade, valor_unitario,
      total, item_cancelado, venda_status, venda_confirmada, origem_atualizada_em)
    VALUES (gen_random_uuid()::text, 'TNP', ${vendaId}, ${`${vendaId}-i`}, ${dispositivoIdErp}, ${pdv},
      ${`${DIA}T10:00:00`}::timestamp, ${produto}, ${produto}, ${produto}, 1, ${total},
      ${total}, false, 'CONFIRMADA', true, ${`${DIA}T10:05:00`}::timestamp)
  `);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  sqlTag = (await import('drizzle-orm')).sql;
  const database = await import('@/db/databases');
  db = database.db as unknown as typeof db;
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(database.db, { migrationsFolder: './drizzle' });
  const { VendasAbcService } = await import('./vendas-abc.service');
  const { VendasReportRepository } = await import('./vendas-report.repository');
  servico = new VendasAbcService(new VendasReportRepository());
}, 300_000);

afterAll(async () => {
  await db?.$client.end();
  await container?.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM venda_item_pdv`);
});

describe('filtro de PDV na curva ABC', () => {
  beforeEach(async () => {
    await item('TNP-PC-CXPDV-1', '7', 'PAO DE SAL', 100, 'v1');
    await item('TNP-PC-CXPDV-2', '8', 'BOLO DE CENOURA', 60, 'v2');
  });

  const nomes = (r: { itens: Array<{ produto: string }> }) => r.itens.map((i) => i.produto).sort();

  it('sem filtro, traz os dois caixas', async () => {
    const r = await servico.produtos('TNP', DIA, DIA);

    expect(r.fonte.tipo).toBe('itens');
    expect(nomes(r)).toEqual(['BOLO DE CENOURA', 'PAO DE SAL']);
  });

  it('pelo id do dispositivo, traz só aquele caixa — o filtro do Relatório de vendas', async () => {
    const r = await servico.produtos('TNP', DIA, DIA, undefined, {}, { pdv: '7' });

    expect(nomes(r)).toEqual(['PAO DE SAL']);
    expect(r.fonte.ignorados).toEqual([]);
  });

  it('pelo NOME do caixa, traz o mesmo — o clique do Relatório Gerentes', async () => {
    const r = await servico.produtos('TNP', DIA, DIA, undefined, {}, { pdv: 'TNP-PC-CXPDV-1' });

    expect(nomes(r)).toEqual(['PAO DE SAL']);
  });

  it('o outro caixa continua separado: o filtro não virou "qualquer coisa"', async () => {
    const r = await servico.produtos('TNP', DIA, DIA, undefined, {}, { pdv: 'TNP-PC-CXPDV-2' });

    expect(nomes(r)).toEqual(['BOLO DE CENOURA']);
  });

  it('PDV que não existe devolve lista vazia, não a loja inteira', async () => {
    const r = await servico.produtos('TNP', DIA, DIA, undefined, {}, { pdv: 'CAIXA QUE NAO EXISTE' });

    expect(r.itens).toEqual([]);
  });

  it('o período de vários dias soma os dias, e o filtro de PDV continua valendo', async () => {
    await db.execute(sqlTag`
      INSERT INTO venda_item_pdv (id, loja, venda_id_erp, item_id_erp, dispositivo_id_erp, pdv,
        vendido_em, produto_id_erp, produto_codigo, produto, quantidade, valor_unitario,
        total, item_cancelado, venda_status, venda_confirmada, origem_atualizada_em)
      VALUES (gen_random_uuid()::text, 'TNP', 'v3', 'v3-i', '7', 'TNP-PC-CXPDV-1',
        '2026-10-03T10:00:00'::timestamp, 'PAO DE SAL', 'PAO DE SAL', 'PAO DE SAL', 1, 50,
        50, false, 'CONFIRMADA', true, '2026-10-03T10:05:00'::timestamp)
    `);

    const r = await servico.produtos('TNP', DIA, '2026-10-03', undefined, {}, { pdv: 'TNP-PC-CXPDV-1' });

    expect(r.periodo.dias).toBe(2);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({ produto: 'PAO DE SAL', faturamento: 150, participacao: 100 });
  });
});
