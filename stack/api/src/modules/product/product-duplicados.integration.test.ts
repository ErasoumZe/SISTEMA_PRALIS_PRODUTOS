import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductDuplicadosService } from './product-duplicados.service';

/** Import de `@/db/databases` só DENTRO do beforeAll — ver nota nos outros testes. */
let container: StartedPostgreSqlContainer;
let service: ProductDuplicadosService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  const produto = async (
    id: string, loja: string, nome: string, barras: string | null,
    interno: string | null, custo: number | null, base: string | null = null,
  ) => {
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras, codigo_interno, custo, base_product_id)
      VALUES (${id}, ${loja}, ${'PR-' + id}, ${nome}, 'UN', 'revenda', 'ativo', 1, 1,
              false, false, ${barras}, ${interno}, ${custo}, ${base})`);
  };
  const fiscal = async (id: string, ncm: string, cst: string) => {
    await db.execute(sqlTag`
      INSERT INTO product_fiscal (product_id, ncm, cst_pis_cofins) VALUES (${id}, ${ncm}, ${cst})`);
  };
  const venda = async (loja: string, codigo: string, nome: string, total: number) => {
    await db.execute(sqlTag`
      INSERT INTO venda_produto_dia (id, loja, data, produto_codigo, produto, produto_id_erp,
                                     quantidade, valor_unitario, total, hash, origem_atualizada_em)
      VALUES (${`v-${codigo}-${nome}`}, ${loja}, CURRENT_DATE - 5, ${codigo}, ${nome}, '',
              1, ${total}, ${total}, ${`h-${codigo}-${nome}`}, '2026-08-31 10:00:00')`);
  };

  // duas linhas TNP com o MESMO codigo de barras, fiscal divergente
  await produto('a1', 'TNP', 'COCA COLA 2L', '7891000100103', '00001', 5, 'base-x');
  await produto('a2', 'TNP', 'REFRI COCA COLA 2 LITROS', '7891000100103', '00002', 6, 'base-x');
  await fiscal('a1', '22021000', '1');
  await fiscal('a2', '22029900', '4'); // NCM e CST diferentes de proposito

  // nomes parecidos, sem codigo de barras
  await produto('b1', 'TNP', 'PAO FRANCES KG', null, '00010', 3, 'base-y');
  await produto('b2', 'TNP', 'PAO FRANCES QUILO', null, '00011', 3, 'base-y');

  // produto de loja SEM base (caso D2)
  await produto('c1', 'TNP', 'PRODUTO ORFAO', '7899999999999', '00020', 2, null);

  // outra loja: NAO pode aparecer no diagnostico da TNP
  await produto('d1', 'LI', 'COCA COLA 2L', '7891000100103', '00001', 5, 'base-x');

  // faturamento dos ultimos 90 dias, para ordenar a fila
  await venda('TNP', '7891000100103', 'COCA COLA 2L', 900);
  await venda('TNP', '7899999999999', 'PRODUTO ORFAO', 10);

  const { ProductDuplicadosService } = await import('./product-duplicados.service');
  service = new ProductDuplicadosService();
}, 180000);

afterAll(async () => {
  await db?.$client?.end().catch(() => {});
  await container?.stop();
});

describe('diagnóstico de cadastros duplicados (Postgres real)', () => {
  it('acha o par com o mesmo código de barras na mesma loja', async () => {
    const r = await service.diagnosticar('TNP', 75);
    const porBarras = r.grupos.filter((g) => g.motivo === 'codigo_barras');

    expect(porBarras).toHaveLength(1);
    expect(porBarras[0]!.produtos.map((p) => p.id).sort()).toEqual(['a1', 'a2']);
  });

  it('marca que o fiscal DIVERGE — fundir aí exige decisão, não pode ser automático', async () => {
    const r = await service.diagnosticar('TNP', 75);
    const grupo = r.grupos.find((g) => g.motivo === 'codigo_barras')!;

    expect(grupo.fiscalDiverge).toBe(true);
    expect(grupo.camposDiferentes).toEqual(expect.arrayContaining(['ncm', 'cstPisCofins', 'custo']));
  });

  it('NÃO junta lojas diferentes: a Coca da LI não entra no diagnóstico da TNP', async () => {
    const r = await service.diagnosticar('TNP', 75);

    expect(r.grupos.flatMap((g) => g.produtos).map((p) => p.id)).not.toContain('d1');
  });

  it('sugere o par de nomes parecidos acima do piso', async () => {
    const r = await service.diagnosticar('TNP', 60);
    const porNome = r.grupos.filter((g) => g.motivo === 'nome');

    expect(porNome.some((g) => g.produtos.map((p) => p.id).sort().join() === 'b1,b2')).toBe(true);
    expect(porNome[0]!.semelhanca).toBeGreaterThanOrEqual(60);
  });

  it('piso alto deixa de sugerir o par duvidoso', async () => {
    const r = await service.diagnosticar('TNP', 99);

    expect(r.grupos.filter((g) => g.motivo === 'nome')).toHaveLength(0);
  });

  it('aponta o produto de loja sem vínculo com a BASE', async () => {
    const r = await service.diagnosticar('TNP', 75);
    const semBase = r.grupos.filter((g) => g.motivo === 'sem_base');

    expect(semBase).toHaveLength(1);
    expect(semBase[0]!.produtos[0]!.id).toBe('c1');
    expect(semBase[0]!.produtos[0]!.temBase).toBe(false);
  });

  it('ordena por DINHEIRO, não por semelhança', async () => {
    const r = await service.diagnosticar('TNP', 60);

    expect(r.grupos[0]!.motivo).toBe('codigo_barras'); // R$ 900 nos últimos 90 dias
    expect(r.grupos[0]!.faturamento90d).toBe(900);
    for (let i = 1; i < r.grupos.length; i++) {
      expect(r.grupos[i - 1]!.faturamento90d).toBeGreaterThanOrEqual(r.grupos[i]!.faturamento90d);
    }
  });

  it('resume quantos grupos de cada tipo e quanto dinheiro está preso', async () => {
    const r = await service.diagnosticar('TNP', 60);

    expect(r.produtosAnalisados).toBe(5);
    expect(r.totais).toMatchObject({ codigoBarras: 1, semBase: 1 });
    // "sem base" não é duplicata: não entra no dinheiro envolvido
    expect(r.faturamentoEnvolvido).toBe(900);
  });

  it('não altera nada — é diagnóstico', async () => {
    const antes = await db.execute(sqlTag`SELECT count(*)::int c FROM products`);
    await service.diagnosticar('TNP', 60);
    const depois = await db.execute(sqlTag`SELECT count(*)::int c FROM products`);

    expect(depois.rows[0]!.c).toBe(antes.rows[0]!.c);
  });
});
