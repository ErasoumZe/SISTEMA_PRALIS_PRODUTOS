import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { CurrentUser } from '@/types/fastify-jwt';
import type { LinhaMixCompleta } from './importar-mix.motor';

/**
 * A importação criando produto de verdade.
 *
 * O motor prova a decisão; isto prova o que fica no banco — inclusive as duas
 * coisas que só existem em SQL: o código de cadastro vindo da planilha (e não
 * da sequência interna) e o espelho enfileirado dentro da transação de criação.
 */
let container: StartedPostgreSqlContainer;
let db: typeof import('@/db/databases')['db'];
let sqlTag: typeof import('drizzle-orm')['sql'];
let servico: InstanceType<typeof import('./importar-mix.service')['ImportarMixService']>;

const JOSE: CurrentUser = { id: 'u1', name: 'José', email: 'j@c.br', loja: null, role: 'admin' };
const FRASE = 'IMPORTAR PRODUTOS DA PLANILHA';

/** O que a planilha devolve neste teste. */
const planilha = { linhas: [] as LinhaMixCompleta[], estado: 'ok' as string };
const espelho = { enfileirados: [] as string[] };

const linha = (over: Partial<LinhaMixCompleta> = {}): LinhaMixCompleta => ({
  linha: 11,
  codigo: '13072',
  nome: 'KITKAT 41,5G BRANCO',
  codigoBarras: '7891000249239',
  ativo: 'SIM',
  ippt: 'T',
  grupo: 'MER BOMBONIERI',
  marca: 'NESTLE',
  embalagem: 'CX',
  quantidadeEmbalagem: '30',
  unidade: 'UNID',
  setor: 'LOJA',
  estoqueMin: '5',
  estoqueMax: '50',
  custo: '',
  ...over,
});

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();

  const dbModule = await import('@/db/databases');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  db = dbModule.db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  const { ImportarMixService } = await import('./importar-mix.service');
  const { CodigoCadastroRepository } = await import('./codigo-cadastro.repository');
  const { ProductRepository } = await import('./product.repository');

  const sheetsFalso = {
    async registerPending(id: string) { espelho.enfileirados.push(id); },
  };
  servico = new ImportarMixService(
    {
      async ler() {
        return {
          estado: planilha.estado, linhas: planilha.linhas, teto: 13439,
          descartadas: 0, faltando: [], truncada: false,
        };
      },
    } as never,
    new CodigoCadastroRepository(sheetsFalso as never),
    new ProductRepository(),
    sheetsFalso as never,
  );
}, 180000);

afterAll(async () => {
  await db.$client.end();
  await container?.stop();
});

const produtos = async () => {
  const r = await db.execute(sqlTag`SELECT * FROM products ORDER BY codigo_interno`);
  return (r.rows ?? []) as Array<Record<string, string | number | null>>;
};

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM products`);
  // `created_by_user_id` referencia `users`: sem esta linha o INSERT viola a FK
  await db.execute(sqlTag`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (${JOSE.id}, ${JOSE.name}, ${JOSE.email}, 'x', 'admin')
    ON CONFLICT (id) DO NOTHING
  `);
  planilha.linhas = [];
  planilha.estado = 'ok';
  espelho.enfileirados = [];
});

describe('ImportarMixService', () => {
  it('cria o produto na Base com o código da planilha', async () => {
    planilha.linhas = [linha()];

    const r = await servico.importar(JOSE, FRASE);

    // falhas ANTES da contagem: quando a criação quebra, é aqui que está o porquê
    expect(r.falhas).toEqual([]);
    expect(r).toMatchObject({ criados: 1, restantes: 0 });
    const [p] = await produtos();
    expect(p).toMatchObject({
      loja: 'BASE',
      nome: 'KITKAT 41,5G BRANCO',
      // o código de cadastro é o da planilha, NÃO a sequência interna
      codigo_interno: '13072',
      codigo_barras: '7891000249239',
      medida_base: 'UN',
      tipo: 'revenda',
      status: 'ativo',
      grupo: 'MER BOMBONIERI',
      marca: 'NESTLE',
      embalagem: 'CX',
      setor_estoque: 'LOJA',
      qt_cad: 30,
    });
    expect(p!.created_by_name).toBe('José');
    expect(String(p!.codigo)).toMatch(/^PR-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('enfileira o espelho da planilha oficial para cada produto criado', async () => {
    planilha.linhas = [linha(), linha({ linha: 12, codigo: '13073', codigoBarras: '7891000249240' })];

    await servico.importar(JOSE, FRASE);

    expect(espelho.enfileirados).toHaveLength(2);
    const ids = (await produtos()).map((p) => p.id);
    expect(espelho.enfileirados.sort()).toEqual(ids.sort());
  });

  it('não cria de novo o que já existe — rodar duas vezes não duplica', async () => {
    planilha.linhas = [linha()];

    await servico.importar(JOSE, FRASE);
    const segunda = await servico.importar(JOSE, FRASE);

    expect(segunda.criados).toBe(0);
    expect(await produtos()).toHaveLength(1);
  });

  it('IPPT P entra como transformação', async () => {
    planilha.linhas = [linha({ ippt: 'P', nome: 'PAO DE QUEIJO' })];
    await servico.importar(JOSE, FRASE);
    expect((await produtos())[0]).toMatchObject({ tipo: 'transformacao' });
  });

  it('ATIVO = NÃO entra inativo, e o produto existe', async () => {
    planilha.linhas = [linha({ ativo: 'NÃO' })];
    await servico.importar(JOSE, FRASE);
    expect((await produtos())[0]).toMatchObject({ status: 'inativo' });
  });

  /*
   * O ponto da tarefa: campo que a planilha não traz fica VAZIO. Um custo
   * chutado viraria preço de venda errado na etiqueta.
   */
  it('deixa vazio o que a planilha não trouxe, em vez de inventar', async () => {
    planilha.linhas = [linha({ grupo: '', marca: '', setor: '', estoqueMin: '', estoqueMax: '', embalagem: 'CONJ' })];
    await servico.importar(JOSE, FRASE);
    const [p] = await produtos();
    expect(p).toMatchObject({
      grupo: null, marca: null, setor_estoque: null, estoque_min: null, estoque_max: null,
      embalagem: null, custo: null,
    });
  });

  it('pula a linha sem o mínimo e diz quantas entraram', async () => {
    planilha.linhas = [
      linha({ linha: 11, codigo: '13072' }),
      linha({ linha: 12, codigo: '13073', nome: '', codigoBarras: '' }),
      linha({ linha: 13, codigo: '13074', unidade: 'DUZIA', codigoBarras: '' }),
    ];
    const r = await servico.importar(JOSE, FRASE);
    expect(r.criados).toBe(1);
    expect(await produtos()).toHaveLength(1);
  });

  it('recusa frase errada e não cria nada', async () => {
    planilha.linhas = [linha()];
    await expect(servico.importar(JOSE, 'pode ir')).rejects.toThrow(/confirma/i);
    expect(await produtos()).toHaveLength(0);
  });

  it('recusa quando a planilha não pôde ser lida', async () => {
    planilha.estado = 'falhou';
    await expect(servico.importar(JOSE, FRASE)).rejects.toThrow(/não pôde ser lida/i);
    expect(await produtos()).toHaveLength(0);
  });

  it('a prévia não cria nada e conta o que entraria', async () => {
    planilha.linhas = [linha(), linha({ linha: 12, codigo: '13073', nome: '', codigoBarras: '' })];
    const previa = await servico.previa();
    expect(previa.importar).toBe(1);
    expect(previa.pular['sem-nome']).toBe(1);
    expect(previa.amostra).toHaveLength(1);
    expect(await produtos()).toHaveLength(0);
  });

  /*
   * Produto que só existe como órfão de loja já ocupa aquele código de barras:
   * importar de novo criaria o duplicado que a Central existe para desfazer.
   */
  it('não importa o que já existe como órfão de loja', async () => {
    await db.execute(sqlTag`
      INSERT INTO products (id, codigo, loja, nome, medida_base, tipo, status, codigo_barras)
      VALUES ('11111111-1111-7111-8111-111111111111', 'PR-AAAA-AAAA', 'LI', 'KITKAT', 'UN', 'revenda', 'ativo', '7891000249239')
    `);
    planilha.linhas = [linha()];

    const r = await servico.importar(JOSE, FRASE);
    expect(r.criados).toBe(0);
    expect(await produtos()).toHaveLength(1);
  });
});
