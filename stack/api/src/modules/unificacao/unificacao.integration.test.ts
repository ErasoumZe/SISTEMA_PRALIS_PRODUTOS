import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { UnificacaoService } from './unificacao.service';

/**
 * ATENÇÃO: nada aqui pode importar `@/db/databases` de forma ESTÁTICA — o
 * módulo abre a conexão no load, antes do `beforeAll` apontar para o container.
 *
 * Este teste lê os CSVs REAIS de `docs/`. É de propósito: o gate da fatia é a
 * contagem por fonte bater com o arquivo que o José entregou.
 */
let container: StartedPostgreSqlContainer;
let service: UnificacaoService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

let produto: (id: string, loja: string, nome: string, barras: string | null) => Promise<void>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  produto = async (id, loja, nome, barras) => {
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras, codigo_interno, custo)
      VALUES (${id}, ${loja}, ${'PR-' + id}, ${nome}, 'UN', 'revenda', 'ativo', 1, 1,
              false, false, ${barras}, '00042', 2.5)`);
  };

  const { UnificacaoService } = await import('./unificacao.service');
  const { ProductRepository } = await import('@/modules/product/product.repository');
  service = new UnificacaoService(new ProductRepository());
});

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM unif_fonte_produto`);
  await db.execute(sqlTag`DELETE FROM products`);
});

const porFonte = (health: Awaited<ReturnType<UnificacaoService['health']>>) =>
  Object.fromEntries(health.fontes.map((f) => [f.fonte, f.linhas]));

describe('carregamento das fontes reais', () => {
  it('carrega as 4 fontes com a contagem do arquivo entregue', async () => {
    const health = await service.carregar();

    expect(porFonte(health)).toMatchObject({
      sia_li: 4186,
      compilart_tnp: 4309,
      planilha_tnp: 3122,
      fiscal_tnp: 940,
    });
  });

  it('traz a base viva do Pralis como mais uma fonte', async () => {
    await produto('p1', 'BASE', 'ARROZ', '7891000100103');
    await produto('p2', 'TNP', 'FEIJAO', null);

    const health = await service.carregar();

    expect(porFonte(health).pralis).toBe(2);
  });

  it('recarregar NAO duplica — e retrato, nao historico', async () => {
    await produto('p1', 'BASE', 'ARROZ', '7891000100103');

    const primeira = await service.carregar();
    const segunda = await service.carregar();

    expect(segunda.total).toBe(primeira.total);
    const linhas = await db.execute(sqlTag`SELECT count(*)::int c FROM unif_fonte_produto`);
    expect(linhas.rows[0]!.c).toBe(primeira.total);
  });

  it('NAO encosta na tabela products', async () => {
    await produto('p1', 'BASE', 'ARROZ', '7891000100103');
    const antes = await db.execute(sqlTag`SELECT count(*)::int c, max(nome) n FROM products`);

    await service.carregar();

    const depois = await db.execute(sqlTag`SELECT count(*)::int c, max(nome) n FROM products`);
    expect(depois.rows[0]).toEqual(antes.rows[0]);
  });
});

describe('o que o staging preserva do arquivo', () => {
  beforeEach(async () => { await service.carregar(); });

  it('desembrulha o CST do SIA — nada de ="040" no banco', async () => {
    const r = await db.execute(sqlTag`
      SELECT count(*)::int c FROM unif_fonte_produto WHERE fonte = 'sia_li' AND cst LIKE '=%'`);

    expect(r.rows[0]!.c).toBe(0);
  });

  it('normaliza a chave de barras para casar entre fontes', async () => {
    const r = await db.execute(sqlTag`
      SELECT cod_barras, chave_barras FROM unif_fonte_produto
      WHERE fonte = 'sia_li' AND cod_barras = '00000000010000' LIMIT 1`);

    expect(r.rows[0]).toMatchObject({ cod_barras: '00000000010000', chave_barras: '10000' });
  });

  it('a planilha antiga entra sem barras, sem inventar chave', async () => {
    const r = await db.execute(sqlTag`
      SELECT count(*)::int c FROM unif_fonte_produto
      WHERE fonte = 'planilha_tnp' AND chave_barras <> ''`);

    expect(r.rows[0]!.c).toBe(0);
  });

  it('o fiscal da contabilidade entra sem status — nulo, nao falso', async () => {
    const r = await db.execute(sqlTag`
      SELECT count(*) FILTER (WHERE ativo IS NULL)::int nulos, count(*)::int total
      FROM unif_fonte_produto WHERE fonte = 'fiscal_tnp'`);

    expect(r.rows[0]).toMatchObject({ nulos: 940, total: 940 });
  });

  it('guarda a linha original em raw, para conferir qualquer valor', async () => {
    const r = await db.execute(sqlTag`
      SELECT raw FROM unif_fonte_produto WHERE fonte = 'sia_li' AND cod_interno = '10000' LIMIT 1`);

    expect(r.rows[0]!.raw).toMatchObject({ CODITEM: '10000', NOME: 'ABACAXI UNID' });
  });

  /*
   * O Compilart tem 4 codigos de barras cobrindo produtos diferentes (um EAN
   * serve "ICE TEA LIMAO" e "ICE TEA PESSEGO"). O staging carrega assim mesmo e
   * ACUSA: esconder nao resolve, e a decisao e humana.
   */
  it('acusa os codigos de barras ambiguos do Compilart', async () => {
    const health = await service.health();
    const compilart = health.fontes.find((f) => f.fonte === 'compilart_tnp')!;

    expect(compilart.barrasConflitantes.length).toBe(4);
    expect(compilart.barrasConflitantes.map((c) => c.chave)).toContain('7891098040909');
  });

  it('o SIA nao tem codigo de barras ambiguo', async () => {
    const sia = (await service.health()).fontes.find((f) => f.fonte === 'sia_li')!;

    expect(sia.barrasConflitantes).toEqual([]);
  });
});

describe('grupo vindo do SIA', () => {
  beforeEach(async () => { await service.carregar(); });

  it('todos os 4.186 do SIA tem grupo — os 17 grupos reais', async () => {
    const sia = (await service.health()).fontes.find((f) => f.fonte === 'sia_li')!;

    expect(sia.comGrupo).toBe(4186);
    expect(sia.grupos).toHaveLength(17);
    expect(sia.grupos[0]).toMatchObject({ grupo: 'PRODUTOS DA CASA', produtos: 1016 });
  });

  it('as fontes da TNP entram SEM grupo — e isso fica visivel', async () => {
    const health = await service.health();
    const compilart = health.fontes.find((f) => f.fonte === 'compilart_tnp')!;

    expect(compilart.comGrupo).toBe(0);
    expect(compilart.grupos).toEqual([]);
  });
});
