import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { VendasRankingService } from './vendas-ranking.service';

/**
 * O ranking por dimensão, contra Postgres de verdade.
 *
 * O que estes testes guardam não é "somou certo" — isso o teste de unidade já
 * prova. É o que só aparece com banco: que a venda casa com o produto pela
 * MESMA regra da margem, que o setor sai do campo certo, e que o faturamento
 * que não casou vira COBERTURA em vez de sumir da conta.
 *
 * Nada de `@/db/databases` estático no topo: o módulo abre conexão no load,
 * antes de o `beforeAll` trocar a DATABASE_URL para o contêiner.
 */
let container: StartedPostgreSqlContainer;
let servico: VendasRankingService;
let db: {
  execute: (q: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  const { VendasRankingService } = await import('./vendas-ranking.service');
  const { VendasReportRepository } = await import('./vendas-report.repository');
  const { FatorPontosService } = await import('./fator-pontos.service');
  const { FatorPontosRepository } = await import('./fator-pontos.repository');
  servico = new VendasRankingService(new VendasReportRepository(), new FatorPontosService(new FatorPontosRepository()));
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await container?.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM produto_creare`);
  await db.execute(sqlTag`DELETE FROM venda_produto_dia`);
  await db.execute(sqlTag`DELETE FROM fechamento_caixa_dia`);
  await db.execute(sqlTag`DELETE FROM products`);
});

const DIA = '2026-03-10';

/** Produto do cadastro, com o que o ranking lê dele. */
async function produto(o: {
  id: string; nome: string; barras?: string | null; grupo?: string | null; setor?: string | null;
}) {
  await db.execute(sqlTag`
    INSERT INTO products (id, codigo, loja, nome, medida_base, tipo, status,
                          codigo_barras, grupo, setor_estoque)
    VALUES (${o.id}, ${`PR-${o.id}`}, 'TNP', ${o.nome}, 'UN', 'revenda', 'ativo',
            ${o.barras ?? null}, ${o.grupo ?? null}, ${o.setor ?? null})
  `);
}

/**
 * Uma linha de venda do PDV, já agregada por dia como o robô manda.
 *
 * O `id` vai EXPLÍCITO: a tabela gera a chave pelo `$defaultFn` do Drizzle, que
 * é código TypeScript — não existe `DEFAULT` no banco. Inserindo por SQL cru,
 * como aqui, ninguém preenche por nós e o Postgres recusa com 23502.
 */
async function venda(o: { codigo: string; nome: string; total: number; qtd?: number }) {
  await db.execute(sqlTag`
    INSERT INTO venda_produto_dia (id, loja, data, produto_codigo, produto, quantidade,
                                   valor_unitario, total, hash, origem_atualizada_em)
    VALUES (gen_random_uuid()::text, 'TNP', ${DIA}, ${o.codigo}, ${o.nome}, ${o.qtd ?? 1}, ${o.total},
            ${o.total}, ${`h-${o.codigo}-${o.nome}`}, ${`${DIA}T12:00:00Z`})
  `);
}

describe('ranking por SETOR — o que serve para bonificar', () => {
  it('soma o faturamento no setor do produto e pontua a 25%', async () => {
    await produto({ id: 'p1', nome: 'PAO FRANCES', barras: '111', setor: 'PROD. - PANIFICAÇÃO' });
    await produto({ id: 'p2', nome: 'BOLO', barras: '222', setor: 'PROD. - CONFEITARIA' });
    await venda({ codigo: '111', nome: 'PAO FRANCES', total: 400 });
    await venda({ codigo: '222', nome: 'BOLO', total: 600 });

    const r = await servico.ranking('TNP', DIA, DIA, 'setor');

    expect(r.campo).toBe('setorEstoque');
    expect(r.itens.map((i) => [i.rotulo, i.faturamento, i.pontos, i.posicao])).toEqual([
      ['PROD. - CONFEITARIA', 600, 150, 1],
      ['PROD. - PANIFICAÇÃO', 400, 100, 2],
    ]);
    expect(r.pontosTotal).toBe(250);
    expect(r.cobertura.percentual).toBe(100);
  });

  /**
   * As duas ausências são DIFERENTES e mandam a pessoa para telas diferentes:
   * venda que não casou com produto nenhum se conserta no de-para; produto que
   * casou mas está sem setor se conserta no cadastro.
   */
  it('separa "venda sem produto" de "produto sem setor"', async () => {
    await produto({ id: 'p1', nome: 'PAO', barras: '111', setor: 'PROD. - PANIFICAÇÃO' });
    await produto({ id: 'p2', nome: 'SEM SETOR', barras: '222', setor: null });
    await venda({ codigo: '111', nome: 'PAO', total: 500 });
    await venda({ codigo: '222', nome: 'SEM SETOR', total: 300 });
    await venda({ codigo: '999', nome: 'NAO EXISTE NO CADASTRO', total: 200 });

    const r = await servico.ranking('TNP', DIA, DIA, 'setor');

    // o produto sem setor APARECE no ranking, nomeado
    expect(r.itens.map((i) => i.rotulo)).toEqual([
      'PROD. - PANIFICAÇÃO', 'Sem classificação no cadastro',
    ]);
    // a venda que não casou com produto nenhum vira cobertura, não item
    expect(r.cobertura).toMatchObject({
      faturamentoClassificado: 800,
      faturamentoSemClassificacao: 200,
      percentual: 80,
      linhasSemVinculo: 1,
    });
  });

  /**
   * O de-para confirmado por pessoa tem precedência sobre o casamento por
   * código — a mesma regra da margem. Sem isso, o ranking classificaria no
   * setor errado justamente o produto que alguém já corrigiu à mão.
   */
  it('respeita o de-para confirmado, como a margem faz', async () => {
    await produto({ id: 'p1', nome: 'COXINHA', barras: '111', setor: 'PROD. - CONFEITARIA' });
    await db.execute(sqlTag`
      INSERT INTO produto_creare (id, loja, produto_codigo, produto, product_id)
      VALUES (gen_random_uuid()::text, 'TNP', 'SEM-CODIGO', 'SALGADO AVULSO', 'p1')
    `);
    await venda({ codigo: 'SEM-CODIGO', nome: 'SALGADO AVULSO', total: 700 });

    const r = await servico.ranking('TNP', DIA, DIA, 'setor');

    expect(r.itens[0]).toMatchObject({ rotulo: 'PROD. - CONFEITARIA', faturamento: 700 });
    expect(r.cobertura.percentual).toBe(100);
  });

  it('o campo do setor é escolhível — o dia em que setorVenda1 for preenchido', async () => {
    await produto({ id: 'p1', nome: 'PAO', barras: '111', setor: 'PROD. - PANIFICAÇÃO' });
    await venda({ codigo: '111', nome: 'PAO', total: 100 });

    const r = await servico.ranking('TNP', DIA, DIA, 'setor', 'setorVenda1');

    expect(r.campo).toBe('setorVenda1');
    // hoje o campo está vazio em todo o cadastro: o ranking diz isso em vez de mentir
    expect(r.itens[0]?.rotulo).toBe('Sem classificação no cadastro');
  });
});

describe('ranking por GRUPO e por PRODUTO', () => {
  it('agrupa pelo grupo de mercadorias do cadastro', async () => {
    await produto({ id: 'p1', nome: 'COCA', barras: '111', grupo: 'MER BEBIDAS - REFRIGERANTES' });
    await produto({ id: 'p2', nome: 'FANTA', barras: '222', grupo: 'MER BEBIDAS - REFRIGERANTES' });
    await venda({ codigo: '111', nome: 'COCA', total: 300 });
    await venda({ codigo: '222', nome: 'FANTA', total: 200 });

    const r = await servico.ranking('TNP', DIA, DIA, 'grupo');

    expect(r.campo).toBe('grupo');
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({ rotulo: 'MER BEBIDAS - REFRIGERANTES', faturamento: 500 });
  });

  /**
   * Produto NÃO precisa casar com o cadastro: a própria venda é a chave. Casar
   * perderia da lista justamente o que o PDV vendeu sem código — que é o que
   * mais interessa ver.
   */
  it('lista produto direto da venda, inclusive o que não está no cadastro', async () => {
    await venda({ codigo: '', nome: 'PRODUTO SEM CODIGO NO PDV', total: 900, qtd: 5 });

    const r = await servico.ranking('TNP', DIA, DIA, 'produto');

    expect(r.campo).toBeNull();
    expect(r.itens[0]).toMatchObject({
      rotulo: 'PRODUTO SEM CODIGO NO PDV', faturamento: 900, quantidade: 5,
    });
    expect(r.cobertura.percentual).toBe(100);
  });
});

describe('ranking por PDV — o dinheiro por caixa', () => {
  async function fechamento(o: { pdv: string; operador: string; total: number; vendas: number }) {
    await db.execute(sqlTag`
      INSERT INTO fechamento_caixa_dia (id, loja, data, pdv, operador, natureza,
        primeira_venda, ultima_venda, numero_vendas, total_pagamento, hash, origem_atualizada_em)
      VALUES (gen_random_uuid()::text, 'TNP', ${DIA}, ${o.pdv}, ${o.operador}, 'VENDA',
        ${`${DIA}T08:00:00Z`}, ${`${DIA}T18:00:00Z`}, ${o.vendas}, ${o.total},
        ${`h-${o.pdv}-${o.operador}`}, ${`${DIA}T19:00:00Z`})
    `);
  }

  it('ranqueia caixa por faturamento, com o nº de vendas junto', async () => {
    await fechamento({ pdv: 'PDV 01', operador: 'MARIA', total: 3000, vendas: 120 });
    await fechamento({ pdv: 'PDV 02', operador: 'JOAO', total: 5000, vendas: 150 });

    const r = await servico.ranking('TNP', DIA, DIA, 'pdv');

    expect(r.itens.map((i) => [i.rotulo, i.faturamento, i.numeroVendas, i.posicao])).toEqual([
      ['PDV 02 — JOAO', 5000, 150, 1],
      ['PDV 01 — MARIA', 3000, 120, 2],
    ]);
    // o fechamento É o total, não uma amostra que precisou casar com cadastro
    expect(r.cobertura.percentual).toBe(100);
    // quantidade de ITENS não existe no fechamento: ele conta vendas
    expect(r.itens.every((i) => i.quantidade === null)).toBe(true);
  });
});

describe('ranking — as recusas', () => {
  it('recusa período invertido', async () => {
    await expect(servico.ranking('TNP', '2026-03-10', '2026-03-01', 'setor'))
      .rejects.toThrow(/anterior/i);
  });

  it('recusa período maior que um ano', async () => {
    await expect(servico.ranking('TNP', '2025-01-01', '2026-06-01', 'setor'))
      .rejects.toThrow(/366/);
  });

  it('período sem venda devolve lista vazia, não erro', async () => {
    const r = await servico.ranking('TNP', DIA, DIA, 'setor');

    expect(r.itens).toEqual([]);
    expect(r.faturamentoTotal).toBe(0);
    expect(r.cobertura.percentual).toBe(0);
  });
});
