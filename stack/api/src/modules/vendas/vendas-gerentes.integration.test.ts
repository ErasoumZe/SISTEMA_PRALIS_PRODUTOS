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

async function fechamento(loja: string, data: string, pdv: string, operador: string, total: number) {
  await db.execute(sqlTag`
    INSERT INTO fechamento_caixa_dia (id, loja, data, pdv, operador, natureza,
      primeira_venda, ultima_venda, numero_vendas, total_pagamento, hash, origem_atualizada_em)
    VALUES (gen_random_uuid()::text, ${loja}, ${data}::date, ${pdv}, ${operador}, 'VENDA',
      ${`${data}T08:00:00Z`}, ${`${data}T18:00:00Z`}, 1, ${total},
      ${`${loja}-${data}-${pdv}-${operador}`}, ${`${data}T19:00:00Z`})
  `);
}

describe('relatório gerentes contra o fechamento real', () => {
  it('agrupa operadores por PDV, mantém dias sem dado e isola a loja', async () => {
    await fechamento('TNP', '2026-10-01', 'PDV 1', 'ANA', 100);
    await fechamento('TNP', '2026-10-01', 'PDV 1', 'JOAO', 20);
    await fechamento('TNP', '2026-10-03', 'PDV 2', 'ANA', 80);
    await fechamento('LI', '2026-10-01', 'PDV 9', 'ANA', 1000);

    const r = await servico.relatorio('TNP', { inicio: '2026-10-01', fim: '2026-10-03' });
    expect(r.pdvs).toEqual(['PDV 1', 'PDV 2']);
    expect(r.totalPontos).toBe(50);
    expect(r.series[0]?.dias).toEqual([
      { data: '2026-10-01', pontos: 30 },
      { data: '2026-10-02', pontos: null },
      { data: '2026-10-03', pontos: null },
    ]);
    expect(r.series[1]?.dias[2]?.pontos).toBe(20);
    expect(JSON.stringify(r)).not.toContain('1000');

    const filtrado = await servico.relatorio('TNP', { inicio: '2026-10-01', fim: '2026-10-03', pdv: 'PDV 2' });
    expect(filtrado.series).toHaveLength(1);
    expect(filtrado.totalPontos).toBe(20);
  });
});
