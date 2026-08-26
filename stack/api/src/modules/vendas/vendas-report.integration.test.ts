import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyRequest } from 'fastify';
import type { CurrentUser } from '@/types/fastify-jwt';
import type { VendasReportService } from './vendas-report.service';

/**
 * ATENÇÃO: nada aqui pode importar `@/db/databases` de forma ESTÁTICA.
 * O módulo abre a conexão no load, ou seja, ANTES do `beforeAll` trocar a
 * DATABASE_URL para o container — e a migration rodaria no banco de
 * desenvolvimento de quem está rodando o teste. Só `import type` no topo;
 * o resto entra por `await import` dentro do `beforeAll`.
 */
let reportStore: typeof import('./vendas-report.controller')['reportStore'];

type Fixture = {
  lotes: Array<{ tipo: 'venda_produto_dia' | 'fechamento_caixa_dia'; linhas: Record<string, unknown>[] }>;
};

let container: StartedPostgreSqlContainer;
let service: VendasReportService;
let db: { $client: { end: () => Promise<void> } };

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), '../../docs/superpowers/fixtures/2026-08-26-vendas-reais-anonimizadas.json'),
  'utf8',
)) as Fixture;

/** Ano inteiro: a fixture espalha linhas de janeiro a maio. */
const INICIO = '2026-01-01';
const FIM = '2026-12-31';

const pedido = (user?: Partial<CurrentUser>): FastifyRequest =>
  ({ currentUser: user ? ({ id: 'u', name: 'n', email: 'e', loja: null, role: 'user', ...user }) : undefined }) as FastifyRequest;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  // popula pelo MESMO caminho da ingestão — o relatório lê o que o robô grava
  const { VendasRepository } = await import('./vendas.repository');
  const { VendasService } = await import('./vendas.service');
  const ingestao = new VendasService(new VendasRepository());
  for (const lote of fixture.lotes) {
    await ingestao.importar(lote as never);
  }

  const { VendasReportRepository } = await import('./vendas-report.repository');
  const { VendasReportService } = await import('./vendas-report.service');
  service = new VendasReportService(new VendasReportRepository());
  ({ reportStore } = await import('./vendas-report.controller'));
}, 180000);

afterAll(async () => {
  await db?.$client?.end().catch(() => {});
  await container?.stop();
});

describe('relatório de vendas (Postgres real, SQL de verdade)', () => {
  it('soma o faturamento e a quantidade da própria loja', async () => {
    const r = await service.report('TNP', INICIO, FIM);

    // 6,70 + 8,62 + 32,70 da fixture da TNP
    expect(r.resumo.faturamento).toBeCloseTo(48.02, 2);
    expect(r.resumo.quantidade).toBeCloseTo(6.39, 2);
  });

  it('número de vendas e ticket médio vêm do FECHAMENTO, não das vendas', async () => {
    const r = await service.report('TNP', INICIO, FIM);

    expect(r.resumo.numeroVendas).toBe(214);
    expect(r.resumo.totalPagamentos).toBeCloseTo(2756.53, 2);
    expect(r.resumo.ticketMedio).toBeCloseTo(2756.53 / 214, 4);
  });

  it('NÃO mistura loja: o total da TNP ignora a LI e vice-versa', async () => {
    const tnp = await service.report('TNP', INICIO, FIM);
    const li = await service.report('LI', INICIO, FIM);

    expect(tnp.resumo.faturamento).toBeCloseTo(48.02, 2);
    expect(li.resumo.faturamento).toBeCloseTo(39.66, 2); // 21,46 + 18,20
    expect(li.resumo.numeroVendas).toBe(270);
    // nenhum produto da LI aparece no ranking da TNP
    const codigosTnp = tnp.ranking.maisVendidos.map((p) => p.produtoCodigo);
    expect(codigosTnp).not.toContain('10469');
    expect(codigosTnp).not.toContain('7890000000002');
  });

  it('ranking vem ordenado por quantidade e traz o produto real', async () => {
    const r = await service.report('TNP', INICIO, FIM);

    expect(r.ranking.maisVendidos[0]).toMatchObject({ produtoCodigo: '7890000000001', quantidade: 6 });
    expect(r.ranking.menosVendidos[0]!.quantidade).toBeLessThanOrEqual(r.ranking.maisVendidos[0]!.quantidade);
  });

  it('curva ABC fecha 100% do faturamento da loja', async () => {
    const r = await service.report('TNP', INICIO, FIM);

    const somaClasses = r.curvaAbc.reduce((s, c) => s + c.faturamento, 0);
    const somaProdutos = r.curvaAbc.reduce((s, c) => s + c.produtos, 0);
    expect(somaClasses).toBeCloseTo(r.resumo.faturamento, 2);
    expect(somaProdutos).toBe(3);
    expect(r.curvaAbc.find((c) => c.classe === 'A')).toMatchObject({ produtos: 2 });
  });

  it('pagamentos saem por dia com as formas somadas', async () => {
    const r = await service.report('TNP', INICIO, FIM);

    expect(r.pagamentos).toHaveLength(1);
    expect(r.pagamentos[0]).toMatchObject({ data: '2026-01-02', numeroVendas: 214 });
    expect(r.pagamentos[0]!.total).toBeCloseTo(2756.53, 2);
  });

  it('conta os produtos que o PDV mandou SEM código, em vez de escondê-los', async () => {
    const r = await service.report('TNP', INICIO, FIM);

    // as duas linhas de 02/02 vieram sem PRODUTO_CODIGO e sobrevivem separadas
    expect(r.qualidade.produtosSemCodigo).toBe(2);
    expect(r.qualidade.faturamentoSemCodigo).toBeCloseTo(15.32, 2);
  });

  it('período sem movimento devolve zero, não erro', async () => {
    const r = await service.report('TNP', '2020-01-01', '2020-12-31');

    expect(r.resumo).toMatchObject({ faturamento: 0, numeroVendas: 0, ticketMedio: 0 });
    expect(r.ranking.maisVendidos).toEqual([]);
    expect(r.pagamentos).toEqual([]);
  });

  it('recusa período invertido e período longo demais', async () => {
    await expect(service.report('TNP', '2026-05-01', '2026-01-01')).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
    await expect(service.report('TNP', '2020-01-01', '2026-01-01')).rejects.toMatchObject({ code: 'PERIOD_TOO_LARGE' });
  });
});

describe('quem pode consultar qual loja (mesma função usada pela rota)', () => {
  it('admin escolhe a loja', () => {
    expect(reportStore(pedido({ role: 'admin', loja: null }), 'TNP')).toBe('TNP');
    expect(reportStore(pedido({ role: 'admin', loja: null }), 'LI')).toBe('LI');
  });

  it('usuário da TNP fica na TNP e não alcança a LI', () => {
    expect(reportStore(pedido({ role: 'user', loja: 'TNP' }))).toBe('TNP');
    expect(() => reportStore(pedido({ role: 'user', loja: 'TNP' }), 'LI'))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });

  it('usuário da LI fica na LI e não alcança a TNP', () => {
    expect(reportStore(pedido({ role: 'user', loja: 'LI' }))).toBe('LI');
    expect(() => reportStore(pedido({ role: 'user', loja: 'LI' }), 'TNP'))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });

  it('usuário da HORA recebe 403 mesmo entrando pela URL', () => {
    expect(() => reportStore(pedido({ role: 'user', loja: 'HORA' })))
      .toThrow(expect.objectContaining({ statusCode: 403, code: 'STORE_NOT_SUPPORTED' }));
  });

  it('não autenticado recebe 401', () => {
    expect(() => reportStore(pedido())).toThrow(expect.objectContaining({ statusCode: 401 }));
  });
});
