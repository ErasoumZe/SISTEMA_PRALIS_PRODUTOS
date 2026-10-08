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
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];
let deParaService: import('./vendas-depara.service').VendasDeParaService;

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
  sqlTag = (await import('drizzle-orm')).sql;
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
  const { VendasDeParaService } = await import('./vendas-depara.service');
  deParaService = new VendasDeParaService(new VendasReportRepository());
}, 180000);

afterAll(async () => {
  await db?.$client?.end().catch(() => {});
  await container?.stop();
});

describe('relatório de vendas (Postgres real, SQL de verdade)', () => {
  it('usa o fechamento como faturamento e preserva o valor dos itens', async () => {
    const r = await service.report('TNP', INICIO, FIM);

    // 6,70 + 8,62 + 32,70 da fixture da TNP
    expect(r.resumo.faturamento).toBeCloseTo(2756.53, 2);
    expect(r.resumo.valorItens).toBeCloseTo(48.02, 2);
    expect(r.resumo.origemFaturamento).toBe('fechamento');
    expect(r.resumo.diferencaItensFechamento).toBeCloseTo(2756.53 - 48.02, 2);
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

    expect(tnp.resumo.faturamento).toBeCloseTo(2756.53, 2);
    expect(li.resumo.faturamento).toBeCloseTo(3769.82, 2);
    expect(li.resumo.valorItens).toBeCloseTo(39.66, 2); // 21,46 + 18,20
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

  it('curva ABC fecha o valor dos itens, não o faturamento do caixa', async () => {
    const r = await service.report('TNP', INICIO, FIM);

    const somaClasses = r.curvaAbc.reduce((s, c) => s + c.faturamento, 0);
    const somaProdutos = r.curvaAbc.reduce((s, c) => s + c.produtos, 0);
    expect(somaClasses).toBeCloseTo(r.resumo.valorItens, 2);
    expect(somaProdutos).toBe(3);
    expect(r.curvaAbc.find((c) => c.classe === 'A')).toMatchObject({ produtos: 2 });
  });

  it('pagamentos saem por dia com as formas somadas', async () => {
    const r = await service.report('TNP', INICIO, FIM);

    expect(r.pagamentos).toHaveLength(1);
    expect(r.pagamentos[0]).toMatchObject({ data: '2026-01-02', numeroVendas: 214 });
    expect(r.pagamentos[0]!.total).toBeCloseTo(2756.53, 2);
  });

  it('não chama soma dos itens de faturamento quando o fechamento diverge', async () => {
    const data = '2027-10-06';
    await db.execute(sqlTag`
      INSERT INTO venda_item_pdv (id, loja, venda_id_erp, item_id_erp, dispositivo_id_erp, pdv,
        vendido_em, produto_codigo, produto, quantidade, valor_unitario, total,
        item_cancelado, venda_status, venda_confirmada, origem_atualizada_em)
      VALUES ('teste-faturamento-item', 'TNP', 'teste-cupom', 'teste-item', '1', 'PDV 1',
        ${data + ' 10:00:00'}, '123', 'TESTE', 1, 22024.68, 22024.68,
        false, 'F', true, ${data + ' 10:00:00'})`);
    await db.execute(sqlTag`
      INSERT INTO fechamento_caixa_dia (id, loja, data, pdv, operador, natureza,
        primeira_venda, ultima_venda, numero_vendas, dinheiro, total_pagamento,
        hash, origem_atualizada_em)
      VALUES ('teste-faturamento-fechamento', 'TNP', ${data}, 'PDV 1', 'TESTE', 'VENDA',
        ${data + ' 10:00:00'}, ${data + ' 10:00:00'}, 1433, 21871.46, 21871.46,
        'teste-faturamento-fechamento-hash', ${data + ' 10:00:00'})`);

    const r = await service.report('TNP', data, data, {}, { granularidade: 'hora' });
    expect(r.resumo).toMatchObject({
      origemFaturamento: 'fechamento', faturamento: 21871.46,
      valorItens: 22024.68, diferencaItensFechamento: -153.22,
      numeroVendas: 1433, totalPagamentos: 21871.46,
    });
    expect(r.periodo.granularidade).toBe('dia');
    expect(r.serie).toEqual([{ t: data, total: 21871.46, numeroVendas: 1433 }]);

    const recortePorHora = await service.report('TNP', data, data, {}, { hi: '10:00', hf: '10:00' });
    expect(recortePorHora.resumo).toMatchObject({
      origemFaturamento: 'itens', faturamento: 22024.68,
      valorItens: 22024.68, diferencaItensFechamento: null,
    });
    expect(recortePorHora.periodo.granularidade).toBe('hora');
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

/**
 * Margem e de-para contra o banco real. O cadastro entra por SQL porque o que
 * importa aqui é o CASAMENTO, não o fluxo de cadastro de produto.
 */
describe('margem, cobertura e de-para (Postgres real)', () => {
  const produtoTnp = async (id: string, nome: string, codigoBarras: string | null, custo: number | null) => {
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras, custo)
      VALUES (${id}, 'TNP', ${'PR-' + id}, ${nome}, 'UN', 'revenda', 'ativo', 1, 1,
              false, false, ${codigoBarras}, ${custo})
      ON CONFLICT (id) DO NOTHING`);
  };

  it('sem cadastro nenhum, a cobertura é 0 — e a margem não é inventada', async () => {
    const r = await service.report('TNP', INICIO, FIM);

    expect(r.margem.coberturaPercentual).toBe(0);
    expect(r.margem.margemPercentual).toBe(0);
    expect(r.margem.faturamentoSemCusto).toBeCloseTo(48.02, 2);
  });

  it('produto cadastrado com EAN casa sozinho e levanta a cobertura', async () => {
    await produtoTnp('prod-ean', 'PRODUTO EAN EXEMPLO', '7890000000001', 3);

    const r = await service.report('TNP', INICIO, FIM);

    // 32,70 dos 48,02 passam a ter custo
    expect(r.margem.faturamentoComCusto).toBeCloseTo(32.7, 2);
    expect(r.margem.coberturaPercentual).toBeCloseTo(68.1, 1);
    expect(r.margem.custoTotal).toBeCloseTo(18, 2); // 3 x 6 unidades
    expect(r.margem.lucroBruto).toBeCloseTo(14.7, 2);
  });

  it('lista como pendente só o que NÃO casou, ordenado por faturamento', async () => {
    const lista = await deParaService.pendentes('TNP', INICIO, FIM);

    // as duas linhas sem código continuam pendentes; o EAN já casou
    expect(lista.pendentes.map((p) => p.produto)).not.toContain('PRODUTO EAN EXEMPLO 200ML');
    expect(lista.pendentes.length).toBe(2);
    expect(lista.pendentes[0]!.faturamento).toBeGreaterThanOrEqual(lista.pendentes[1]!.faturamento);
    expect(lista.faturamentoPendente).toBeCloseTo(15.32, 2);
  });

  it('sugere candidato por semelhança de nome, sem vincular nada', async () => {
    const pendente = (await deParaService.pendentes('TNP', INICIO, FIM)).pendentes[0]!;
    await produtoTnp('prod-parecido', pendente.produto, null, 1);

    const depois = (await deParaService.pendentes('TNP', INICIO, FIM))
      .pendentes.find((p) => p.produto === pendente.produto)!;

    expect(depois.sugestoes.length).toBeGreaterThan(0);
    expect(depois.sugestoes[0]!.semelhanca).toBeGreaterThan(50);
    // sugerir NÃO vincula: continua pendente
    expect(depois.produtoCodigo).toBe(pendente.produtoCodigo);
  });

  it('vínculo confirmado tira da fila e entra na cobertura', async () => {
    const antes = await deParaService.pendentes('TNP', INICIO, FIM);
    const alvo = antes.pendentes[0]!;

    await deParaService.vincular('TNP', alvo.produtoCodigo, alvo.produto, 'prod-parecido', 'ZZ Teste');

    const depois = await deParaService.pendentes('TNP', INICIO, FIM);
    const relatorio = await service.report('TNP', INICIO, FIM);

    expect(depois.pendentes.length).toBe(antes.pendentes.length - 1);
    expect(relatorio.margem.coberturaPercentual).toBeGreaterThan(68.1);
  });

  it('produto SEM código do PDV também pode ser vinculado', async () => {
    // é o caso dos pesáveis: o de-para é identificado pela descrição
    const vinculo = await db.execute(sqlTag`
      SELECT produto_codigo, produto FROM produto_creare WHERE loja = 'TNP'`);

    expect(vinculo.rows).toHaveLength(1);
    expect(String(vinculo.rows[0]!.produto_codigo)).toBe('');
    expect(String(vinculo.rows[0]!.produto)).not.toBe('');
  });

  it('desfazer o vínculo devolve o código para a fila', async () => {
    const antes = await deParaService.pendentes('TNP', INICIO, FIM);
    const vinculo = await db.execute(sqlTag`
      SELECT produto_codigo, produto FROM produto_creare WHERE loja = 'TNP'`);
    const linha = vinculo.rows[0]!;

    await deParaService.vincular('TNP', String(linha.produto_codigo), String(linha.produto), null, 'ZZ Teste');

    const depois = await deParaService.pendentes('TNP', INICIO, FIM);
    expect(depois.pendentes.length).toBe(antes.pendentes.length + 1);
  });

  it('NÃO deixa vincular produto de outra loja', async () => {
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto)
      VALUES ('prod-li', 'LI', 'PR-LI', 'DA LISBOA', 'UN', 'revenda', 'ativo', 1, 1, false, false)
      ON CONFLICT (id) DO NOTHING`);

    await expect(deParaService.vincular('TNP', '7890000000001', 'ALGUM', 'prod-li', 'ZZ Teste'))
      .rejects.toMatchObject({ code: 'PRODUCT_OTHER_STORE' });
  });

  it('recusa produto inexistente em vez de gravar vínculo quebrado', async () => {
    await expect(deParaService.vincular('TNP', '123', 'ALGUM', 'nao-existe', 'ZZ Teste'))
      .rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });

    await expect(deParaService.vincular('TNP', '123', '   ', 'prod-ean', 'ZZ Teste'))
      .rejects.toMatchObject({ code: 'DESCRIPTION_REQUIRED' });
  });
});

/**
 * Caso real observado em produção em 01/09/2026: a fila de de-para oferecia
 * "BOLO PRALIS LIMAO 250 G" (custo R$ 5,00) para "PAO DE SAL PRALIS"
 * (R$ 46.856 de faturamento) com 50% de semelhança — as duas frases dividem
 * "PRALIS" e várias sílabas. Confirmar isso calcularia a margem de 2.103 kg de
 * pão com o custo de um bolo.
 *
 * Isolado em LI e num dia próprio: a sequência de TNP acima é encadeada.
 */
describe('sugestão ruim é pior que sugestão nenhuma', () => {
  const DIA = '2026-11-11';

  beforeAll(async () => {
    await db.execute(sqlTag`
      INSERT INTO venda_produto_dia (id, loja, data, produto_codigo, produto, quantidade,
                                     valor_unitario, total, hash, origem_atualizada_em)
      VALUES ('vp-pao', 'LI', ${DIA}, '00000000012862', 'PAO DE SAL PRALIS', 100,
              10.00, 1000.00, 'h-pao', now())
      ON CONFLICT DO NOTHING`);

    // único produto do catálogo: um bolo, que NÃO é pão de sal
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade,
                            qt_cad, habilitar_ajuda, auto, codigo_barras, custo)
      VALUES ('li-bolo', 'LI', 'PR-BOLO', 'BOLO PRALIS LIMAO', 'G', 'revenda', 'ativo', 250,
              1, false, false, '2128050024901', 5.00)
      ON CONFLICT (id) DO NOTHING`);
  });

  it('não oferece o bolo para o pão — e nenhuma sugestão abaixo do piso', async () => {
    const lista = await deParaService.pendentes('LI', DIA, DIA);
    const pao = lista.pendentes.find((p) => p.produto === 'PAO DE SAL PRALIS')!;

    expect(pao).toBeDefined();
    expect(pao.sugestoes.map((s) => s.nome)).not.toContain('BOLO PRALIS LIMAO');
    // trava o piso: qualquer sugestão exibida precisa se parecer de verdade
    expect(pao.sugestoes.every((s) => s.semelhanca >= 55)).toBe(true);
  });

  it('marca o código curto como PLU de balança, que é a causa real', async () => {
    const lista = await deParaService.pendentes('LI', DIA, DIA);
    const pao = lista.pendentes.find((p) => p.produto === 'PAO DE SAL PRALIS')!;

    expect(pao.codigoPlu).toBe('12862');
  });

  it('cadastrar com o EAN de balança tira da fila SOZINHO — sem vínculo manual', async () => {
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade,
                            qt_cad, habilitar_ajuda, auto, codigo_barras, custo)
      VALUES ('li-pao', 'LI', 'PR-PAO', 'PAO DE SAL', 'KG', 'revenda', 'ativo', 1,
              1, false, false, '2128620150003', 8.00)
      ON CONFLICT (id) DO NOTHING`);

    const lista = await deParaService.pendentes('LI', DIA, DIA);

    expect(lista.pendentes.map((p) => p.produto)).not.toContain('PAO DE SAL PRALIS');
    const vinculos = await db.execute(sqlTag`
      SELECT count(*)::int c FROM produto_creare WHERE loja = 'LI'`);
    expect(vinculos.rows[0]!.c).toBe(0); // casou pelo código, ninguém confirmou nada
  });
});
