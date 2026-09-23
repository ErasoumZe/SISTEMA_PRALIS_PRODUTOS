import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Zerar o catálogo é a operação mais destrutiva do sistema. O que estes testes
 * guardam não é o "apagou": é o que ele NÃO pode fazer junto.
 *
 * O maior risco é apagar as linhas da planilha. Ela é a FONTE de onde o
 * catálogo vai ser repovoado logo depois — limpá-la junto destruiria justamente
 * o que se pretende importar, e sem volta.
 */
let container: StartedPostgreSqlContainer;
let db: typeof import('@/db/databases')['db'];
let sqlTag: typeof import('drizzle-orm')['sql'];
let ProductZerarService: typeof import('./product-zerar.service')['ProductZerarService'];
let servico: InstanceType<typeof ProductZerarService>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();

  const dbModule = await import('@/db/databases');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  db = dbModule.db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  ({ ProductZerarService } = await import('./product-zerar.service'));
  servico = new ProductZerarService();
}, 120000);

afterAll(async () => {
  // Fecha o pool ANTES de parar o contêiner. Cliente ainda conectado quando o
  // Postgres cai vira `57P01` e suja a saída de quem roda a suíte inteira —
  // um erro que não é de teste nenhum, mas que faz a rodada terminar em 1.
  await db.$client.end();
  await container?.stop();
});

const criarProduto = async (id: string, nome: string, loja = 'BASE', codigoInterno: string | null = null) => {
  await db.execute(sqlTag`
    INSERT INTO products (id, codigo, loja, nome, medida_base, tipo, status, codigo_interno)
    VALUES (${id}, ${`PR-${id.slice(0, 4)}`}, ${loja}, ${nome}, 'UN', 'revenda', 'ativo', ${codigoInterno})
  `);
};

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM products`);
});

describe('ProductZerarService', () => {
  const PILOTO = '11111111-1111-7111-8111-111111111111';
  const CONFIRMACAO = 'ZERAR CATALOGO E MANTER 13125';

  it('preserva exclusivamente o piloto Base 13125 e devolve quantos removeu', async () => {
    await criarProduto(PILOTO, 'BISCOITO PILOTO', 'BASE', '13125');
    await criarProduto('22222222-2222-7222-8222-222222222222', 'LEITE');
    await criarProduto('33333333-3333-7333-8333-333333333333', 'CAFE', 'LI');

    expect(await servico.contar()).toBe(3);
    const r = await servico.zerar(CONFIRMACAO, 3);

    expect(r).toMatchObject({ apagados: 2, preservado: { codigoInterno: '13125', nome: 'BISCOITO PILOTO' } });
    expect(await servico.contar()).toBe(1);
  });

  it('leva junto as tabelas filhas, por cascata', async () => {
    await criarProduto(PILOTO, 'BISCOITO PILOTO', 'BASE', '13125');
    const id = '44444444-4444-7444-8444-444444444444';
    await criarProduto(id, 'QUEIJO');
    await db.execute(sqlTag`INSERT INTO product_fiscal (product_id, ncm) VALUES (${id}, '04061090')`);
    await db.execute(sqlTag`
      INSERT INTO promocoes (id, product_id, tipo, valor)
      VALUES ('55555555-5555-7555-8555-555555555555', ${id}, 'valor', 9.9)
    `);

    await servico.zerar(CONFIRMACAO, 2);

    const fiscal = await db.execute(sqlTag`SELECT count(*)::int AS n FROM product_fiscal`);
    const promo = await db.execute(sqlTag`SELECT count(*)::int AS n FROM promocoes`);
    expect((fiscal.rows[0] as { n: number }).n).toBe(0);
    expect((promo.rows[0] as { n: number }).n).toBe(0);
  });

  it('recusa sem a frase exata e NÃO apaga nada', async () => {
    await criarProduto(PILOTO, 'BISCOITO PILOTO', 'BASE', '13125');

    await expect(servico.zerar('zerar', 1)).rejects.toMatchObject({ code: 'ZERAR_CONFIRMACAO_INVALIDA' });
    expect(await servico.contar()).toBe(1);
  });

  it('recusa quando o total mudou desde que a tela olhou', async () => {
    await criarProduto(PILOTO, 'BISCOITO PILOTO', 'BASE', '13125');
    await criarProduto('77777777-7777-7777-8777-777777777777', 'PAO');
    await criarProduto('88888888-8888-7888-8888-888888888888', 'LEITE');

    // a tela tinha visto 1; alguém cadastrou outro no meio
    await expect(servico.zerar(CONFIRMACAO, 2)).rejects.toMatchObject({ code: 'ZERAR_TOTAL_MUDOU' });
    expect(await servico.contar()).toBe(3);
  });

  it('bloqueia a limpeza se o piloto não existir na Base', async () => {
    await criarProduto('99999999-9999-7999-8999-999999999999', 'SEM PILOTO');
    await expect(servico.previa()).rejects.toMatchObject({ code: 'PILOTO_NAO_ENCONTRADO' });
    expect(await servico.contar()).toBe(1);
  });

  it('não depende de planilha: o serviço não conhece o gateway do Sheets', () => {
    /*
     * Guarda de projeto, não de comportamento. Se um dia alguém injetar o
     * gateway aqui, este teste cai — e é para cair: apagar a planilha junto
     * destruiria a fonte de onde o catálogo é repovoado.
     */
    expect(ProductZerarService.length).toBe(0); // construtor sem dependências
  });
});
