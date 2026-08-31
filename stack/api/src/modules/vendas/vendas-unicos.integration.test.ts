import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { VendasUnicosService } from './vendas-unicos.service';

/**
 * ATENÇÃO: nada aqui pode importar `@/db/databases` de forma ESTÁTICA — o
 * módulo abre a conexão no load, antes do `beforeAll` trocar a DATABASE_URL, e
 * a migration rodaria no banco de desenvolvimento de quem executa o teste.
 */
let container: StartedPostgreSqlContainer;
let service: VendasUnicosService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

const consulta = (over: Record<string, unknown> = {}) => ({
  inicio: '2026-01-01', fim: '2026-12-31', ordenar: 'faturamento' as const,
  pagina: 1, porPagina: 50, ...over,
});

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  const venda = async (
    loja: string, data: string, codigo: string, produto: string,
    qtd: number, total: number, idErp: string,
  ) => {
    await db.execute(sqlTag`
      INSERT INTO venda_produto_dia (id, loja, data, produto_codigo, produto, produto_id_erp,
                                     quantidade, valor_unitario, total, hash, origem_atualizada_em)
      VALUES (${`${loja}-${data}-${produto}-${codigo}`}, ${loja}, ${data}::date, ${codigo}, ${produto},
              ${idErp}, ${qtd}, ${total / qtd}, ${total},
              ${`h-${loja}-${data}-${produto}-${codigo}`}, '2026-08-31 10:00:00')`);
  };

  // MESMO produto (id 900), RENOMEADO no meio do periodo, em 3 dias
  await venda('TNP', '2026-01-10', '111', 'PAO DE QUEIJO', 100, 300, '900');
  await venda('TNP', '2026-02-10', '111', 'PAO DE QUEIJO PQ', 50, 200, '900');
  await venda('TNP', '2026-03-10', '111', 'PAO DE QUEIJO PQ PRALIS', 25, 100, '900');
  // produto legado SEM id do ERP, renomeado — o caso que ainda repete
  await venda('TNP', '2026-01-11', '222', 'COXINHA', 10, 50, '');
  await venda('TNP', '2026-02-11', '222', 'COXINHA GRANDE', 10, 40, '');
  // pesavel sem codigo, com id do ERP
  await venda('TNP', '2026-01-12', '', 'PAO FRANCES KG', 30, 210, '901');
  // outra loja, para provar isolamento
  await venda('LI', '2026-01-10', '111', 'PAO DE QUEIJO', 999, 9999, '900');

  const { VendasUnicosRepository } = await import('./vendas-unicos.repository');
  const { VendasUnicosService } = await import('./vendas-unicos.service');
  service = new VendasUnicosService(new VendasUnicosRepository());
}, 180000);

afterAll(async () => {
  await db?.$client?.end().catch(() => {});
  await container?.stop();
});

describe('produtos únicos (Postgres real)', () => {
  it('o mesmo produto renomeado 3x vira UMA linha — é o pedido do José', async () => {
    const r = await service.listar('TNP', consulta());
    const pao = r.produtos.filter((p) => p.produto.startsWith('PAO DE QUEIJO'));

    expect(pao).toHaveLength(1);
    expect(pao[0]).toMatchObject({ quantidade: 175, faturamento: 600, diasComVenda: 3 });
  });

  it('o nome exibido é o da venda MAIS RECENTE, não o primeiro', async () => {
    const r = await service.listar('TNP', consulta());
    const pao = r.produtos.find((p) => p.produto.startsWith('PAO DE QUEIJO'))!;

    expect(pao.produto).toBe('PAO DE QUEIJO PQ PRALIS');
  });

  it('marca quantos nomes o produto teve no período', async () => {
    const r = await service.listar('TNP', consulta());
    const pao = r.produtos.find((p) => p.produto.startsWith('PAO DE QUEIJO'))!;

    expect(pao.nomesDiferentes).toBe(3);
  });

  it('primeira e última venda saem do período real do produto', async () => {
    const r = await service.listar('TNP', consulta());
    const pao = r.produtos.find((p) => p.produto.startsWith('PAO DE QUEIJO'))!;

    expect(pao).toMatchObject({ primeiraVenda: '2026-01-10', ultimaVenda: '2026-03-10' });
  });

  it('sem id do ERP o produto renomeado AINDA repete — e a tela precisa avisar', async () => {
    const r = await service.listar('TNP', consulta());
    const coxinhas = r.produtos.filter((p) => p.produto.startsWith('COXINHA'));

    expect(coxinhas).toHaveLength(2); // limitação conhecida do histórico antigo
    expect(r.linhasSemIdErp).toBe(2); // e a resposta declara isso
  });

  it('pesável sem código não colapsa com os outros sem código', async () => {
    const r = await service.listar('TNP', consulta());

    expect(r.produtos.find((p) => p.produto === 'PAO FRANCES KG')).toMatchObject({
      codigo: '', quantidade: 30, faturamento: 210,
    });
  });

  it('não mistura loja', async () => {
    const tnp = await service.listar('TNP', consulta());
    const li = await service.listar('LI', consulta());

    // TNP: 600 (pão de queijo) + 50 + 40 (coxinhas) + 210 (pão francês)
    expect(tnp.totalFaturamento).toBe(900);
    expect(li.produtos).toHaveLength(1);
    expect(li.produtos[0]!.faturamento).toBe(9999);
  });

  it('ordena por faturamento, quantidade e nome', async () => {
    const porFat = await service.listar('TNP', consulta({ ordenar: 'faturamento' }));
    const porNome = await service.listar('TNP', consulta({ ordenar: 'nome' }));

    expect(porFat.produtos[0]!.faturamento).toBeGreaterThanOrEqual(porFat.produtos[1]!.faturamento);
    expect(porNome.produtos[0]!.produto.localeCompare(porNome.produtos[1]!.produto)).toBeLessThanOrEqual(0);
  });

  it('busca filtra por nome e o total acompanha', async () => {
    const r = await service.listar('TNP', consulta({ busca: 'coxinha' }));

    expect(r.total).toBe(2);
    expect(r.produtos.every((p) => p.produto.toUpperCase().includes('COXINHA'))).toBe(true);
  });

  it('pagina no servidor, e o total continua sendo o do período', async () => {
    const p1 = await service.listar('TNP', consulta({ porPagina: 1, pagina: 1 }));
    const p2 = await service.listar('TNP', consulta({ porPagina: 1, pagina: 2 }));

    expect(p1.produtos).toHaveLength(1);
    expect(p1.total).toBe(4); // 4 produtos distintos na TNP
    expect(p2.produtos[0]!.produto).not.toBe(p1.produtos[0]!.produto);
  });

  it('a exportação traz o período inteiro, ignorando a paginação', async () => {
    const todos = await service.todos('TNP', { inicio: '2026-01-01', fim: '2026-12-31', ordenar: 'faturamento' });

    expect(todos).toHaveLength(4);
  });
});
