import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FatorPontosService } from './fator-pontos.service';
import type { VendasGerentesService } from './vendas-gerentes.service';

/**
 * A régua de pontos, do banco até o número que aparece no gráfico.
 *
 * O teste da regra pura está em `shared`; aqui se prova o que só o banco
 * responde: qual versão vale em cada data, o que acontece sem nenhuma
 * cadastrada, e — o que importa de verdade — que mudar a régua MUDA a
 * pontuação do relatório.
 *
 * ATENÇÃO: `@/db/databases` só por import dinâmico — ver nota nos outros testes.
 */
let container: StartedPostgreSqlContainer;
let fatores: FatorPontosService;
let gerentes: VendasGerentesService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

async function fechamento(loja: string, data: string, pdv: string, total: number) {
  await db.execute(sqlTag`
    INSERT INTO fechamento_caixa_dia (id, loja, data, pdv, dispositivo_id_erp, operador, natureza,
      primeira_venda, ultima_venda, numero_vendas, total_pagamento, hash, origem_atualizada_em)
    VALUES (gen_random_uuid()::text, ${loja}, ${data}::date, ${pdv}, '7', 'ANA', 'VENDA',
      ${`${data}T08:00:00Z`}, ${`${data}T18:00:00Z`}, 1, ${total},
      ${`${loja}-${data}-${pdv}`}, ${`${data}T19:00:00Z`})
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
  const { FatorPontosService } = await import('./fator-pontos.service');
  const { FatorPontosRepository } = await import('./fator-pontos.repository');
  const { VendasGerentesService } = await import('./vendas-gerentes.service');
  fatores = new FatorPontosService(new FatorPontosRepository());
  gerentes = new VendasGerentesService(fatores);
}, 300_000);

afterAll(async () => {
  await db?.$client.end();
  await container?.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM fator_pontos_versao`);
  await db.execute(sqlTag`DELETE FROM fechamento_caixa_dia`);
});

describe('régua de pontos no banco', () => {
  it('sem nada cadastrado, vale 0,25 — o que o sistema já fazia', async () => {
    expect(await fatores.fatorEm('TNP', '2026-10-06')).toBe(0.25);
  });

  it('vale a vigência que já começou, e a anterior continua valendo no passado', async () => {
    await fatores.salvar({
      loja: 'TNP', vigenciaInicio: '2026-01-01', faturamento: 0.25, ticketMedio: 0.25, ticketEmPontos: false,
    }, 'jose@cicluz');
    await fatores.salvar({
      loja: 'TNP', vigenciaInicio: '2026-11-01', faturamento: 0.4, ticketMedio: 0.4, ticketEmPontos: false,
    }, 'jose@cicluz');

    expect(await fatores.fatorEm('TNP', '2026-10-31')).toBe(0.25);
    expect(await fatores.fatorEm('TNP', '2026-11-01')).toBe(0.4);
    expect(await fatores.fatorEm('TNP', '2026-12-25')).toBe(0.4);
  });

  it('cada loja tem a sua: mexer na TNP não mexe na LI', async () => {
    await fatores.salvar({
      loja: 'TNP', vigenciaInicio: '2026-01-01', faturamento: 0.5, ticketMedio: 0.5, ticketEmPontos: false,
    }, null);

    expect(await fatores.fatorEm('TNP', '2026-10-06')).toBe(0.5);
    expect(await fatores.fatorEm('LI', '2026-10-06')).toBe(0.25);
  });

  it('salvar de novo na mesma vigência corrige, não cria uma segunda régua', async () => {
    const entrada = { loja: 'TNP' as const, vigenciaInicio: '2026-01-01', ticketMedio: 0.25, ticketEmPontos: false };
    await fatores.salvar({ ...entrada, faturamento: 0.25 }, null);
    await fatores.salvar({ ...entrada, faturamento: 0.33 }, null);

    const r = await fatores.consultar('TNP', '2026-10-06');
    expect(r.versoes).toHaveLength(1);
    expect(r.vigenteHoje?.faturamento).toBe(0.33);
  });

  it('recusa fator zero antes de tocar no banco', async () => {
    await expect(fatores.salvar({
      loja: 'TNP', vigenciaInicio: '2026-01-01', faturamento: 0, ticketMedio: 0.25, ticketEmPontos: false,
    }, null)).rejects.toMatchObject({ statusCode: 422, code: 'FATOR_INVALIDO' });

    expect((await fatores.consultar('TNP', '2026-10-06')).versoes).toEqual([]);
  });

  it('apagar uma vigência que não existe é 404, não silêncio', async () => {
    await expect(fatores.apagar('nao-existe')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('o ticket médio guarda régua própria e nasce desligado', async () => {
    await fatores.salvar({
      loja: 'TNP', vigenciaInicio: '2026-01-01', faturamento: 0.25, ticketMedio: 1, ticketEmPontos: false,
    }, null);

    const vigente = await fatores.vigenteEm('TNP', '2026-10-06');
    expect(vigente).toMatchObject({ faturamento: 0.25, ticketMedio: 1, ticketEmPontos: false });
  });
});

/*
 * O que torna a tela útil: o número do relatório MUDA quando a régua muda.
 * Sem este teste, tudo acima poderia estar certo e a configuração continuar
 * sem efeito nenhum — que é o defeito mais fácil de não perceber.
 */
describe('a régua chega ao relatório', () => {
  beforeEach(async () => {
    await fechamento('TNP', '2026-10-01', 'PDV 1', 1000);
  });

  it('sem régua cadastrada, R$ 1.000 valem 250 pontos', async () => {
    const r = await gerentes.relatorio('TNP', { inicio: '2026-10-01', fim: '2026-10-01' });
    expect(r.totalPontos).toBe(250);
  });

  it('com régua de 0,5, os mesmos R$ 1.000 valem 500 pontos', async () => {
    await fatores.salvar({
      loja: 'TNP', vigenciaInicio: '2026-01-01', faturamento: 0.5, ticketMedio: 0.5, ticketEmPontos: false,
    }, null);

    const r = await gerentes.relatorio('TNP', { inicio: '2026-10-01', fim: '2026-10-01' });
    expect(r.totalPontos).toBe(500);
    expect(r.series[0]?.dias[0]?.pontos).toBe(500);
  });

  it('uma régua que só começa depois do período não vale para ele', async () => {
    await fatores.salvar({
      loja: 'TNP', vigenciaInicio: '2026-11-01', faturamento: 0.5, ticketMedio: 0.5, ticketEmPontos: false,
    }, null);

    const r = await gerentes.relatorio('TNP', { inicio: '2026-10-01', fim: '2026-10-01' });
    expect(r.totalPontos).toBe(250);
  });

  it('a régua da LI não muda o relatório da TNP', async () => {
    await fatores.salvar({
      loja: 'LI', vigenciaInicio: '2026-01-01', faturamento: 0.5, ticketMedio: 0.5, ticketEmPontos: false,
    }, null);

    const r = await gerentes.relatorio('TNP', { inicio: '2026-10-01', fim: '2026-10-01' });
    expect(r.totalPontos).toBe(250);
  });
});
