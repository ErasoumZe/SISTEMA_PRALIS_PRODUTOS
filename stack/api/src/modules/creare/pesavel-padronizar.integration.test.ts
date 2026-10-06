import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { PesavelPadronizarService } from './pesavel-padronizar.service';

/**
 * O caminho que grava. O plano tem teste unitário; aqui se prova o que só o
 * banco responde: só os ativos da loja mudam, o espelho acompanha, a prévia
 * envelhecida é recusada e a frase é da loja.
 */
let container: StartedPostgreSqlContainer;
let service: PesavelPadronizarService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

const FRASE = 'TODOS PESAVEIS TNP';

async function produto(id: string, loja: string, codigoInterno: string | null, extras: {
  pesavel?: string | null; tecla?: number | null; validade?: number | null; status?: string; barras?: string | null;
} = {}) {
  await db.execute(sqlTag`
    INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, codigo_interno, codigo_barras, pesavel, tecla_balanca, validade_balanca)
    VALUES (${id}, ${loja}, ${id}, ${`PRODUTO ${id}`}, 'UN', 'revenda', ${extras.status ?? 'ativo'},
      ${codigoInterno}, ${extras.barras ?? null}, ${extras.pesavel ?? null}, ${extras.tecla ?? null}, ${extras.validade ?? null})
  `);
}

async function espelho(id: string, loja: string, coditem: string, pesavel: string | null, tecla: string | null = null, validade: string | null = null, chave = `b${loja}${coditem}`) {
  await db.execute(sqlTag`
    INSERT INTO sia_produto_depara (id, loja, codigo_barras, chave_barras, coditem, pesavel, tecla_balanca, validade_balanca)
    VALUES (${id}, ${loja}, ${`000${coditem}`}, ${chave}, ${coditem}, ${pesavel}, ${tecla}, ${validade})
  `);
}

const ler = async (id: string) => (await db.execute(sqlTag`
  SELECT pesavel, tecla_balanca, validade_balanca FROM products WHERE id = ${id}
`)).rows[0];
const lerEspelho = async (id: string) => (await db.execute(sqlTag`
  SELECT pesavel, tecla_balanca, validade_balanca FROM sia_produto_depara WHERE id = ${id}
`)).rows[0];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  sqlTag = (await import('drizzle-orm')).sql;
  const database = await import('@/db/databases');
  db = database.db as unknown as typeof db;
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(database.db, { migrationsFolder: './drizzle' });
  const { PesavelPadronizarService } = await import('./pesavel-padronizar.service');
  service = new PesavelPadronizarService();
}, 300_000);

afterAll(async () => {
  await db?.$client.end();
  await container?.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM sia_produto_depara`);
  await db.execute(sqlTag`DELETE FROM products`);
});

const aplicar = async () => {
  const previa = await service.previa('TNP');
  return service.aplicar('TNP', FRASE, previa.hashPlano);
};

describe('padronizar pesável nos ativos', () => {
  it('prévia conta sem gravar, e mostra quem deixa de ser N', async () => {
    await produto('era-n', 'TNP', '13167', { pesavel: 'N', tecla: 0, validade: 0 });
    await produto('sem-nada', 'TNP', '13200');
    await produto('ja-ok', 'TNP', '11400', { pesavel: 'S', tecla: 0, validade: 5 });
    await espelho('e1', 'TNP', '13167', 'N', '0', '0');

    const previa = await service.previa('TNP');
    expect(previa).toMatchObject({
      loja: 'TNP', totalAtivos: 3, gravar: 2, invertidos: 1, semValor: 1, jaNoPadrao: 1,
      espelhoCorrigir: 1, semEspelho: 2, confirmacao: FRASE,
      amostraInvertidos: [{ codigoInterno: '13167', nome: 'PRODUTO era-n' }],
    });
    expect(await ler('era-n')).toMatchObject({ pesavel: 'N' });
  });

  it('todo ativo vira S/0/5 e o espelho casado vira S/000/5; inativo, unificado e outra loja ficam como estão', async () => {
    await produto('era-n', 'TNP', '13167', { pesavel: 'N', tecla: 0, validade: 0 });
    await produto('sem-nada', 'TNP', '13200');
    await produto('validade-3', 'TNP', '11400', { pesavel: 'S', tecla: 0, validade: 3 });
    await produto('inativo', 'TNP', '712189', { pesavel: 'N', tecla: 0, validade: 0, status: 'inativo' });
    await produto('morto', 'TNP', '13201', { status: 'unificado' });
    await produto('li', 'LI', '13167', { pesavel: 'N', tecla: 0, validade: 0 });
    await espelho('e-ativo', 'TNP', '13167', 'N', '0', '0');
    await espelho('e-validade', 'TNP', '11400', 'S', '000', '3');
    await espelho('e-inativo', 'TNP', '712189', 'N', '0', '0');
    await espelho('e-li', 'LI', '13167', 'N', '0', '0');

    const r = await aplicar();
    expect(r).toMatchObject({ gravados: 3, invertidos: 1, semValor: 1, jaNoPadrao: 0, espelhosCorrigidos: 2 });
    for (const id of ['era-n', 'sem-nada', 'validade-3']) {
      expect(await ler(id)).toMatchObject({ pesavel: 'S', tecla_balanca: 0, validade_balanca: 5 });
    }
    expect(await lerEspelho('e-ativo')).toEqual({ pesavel: 'S', tecla_balanca: '000', validade_balanca: '5' });
    expect(await lerEspelho('e-validade')).toEqual({ pesavel: 'S', tecla_balanca: '000', validade_balanca: '5' });
    expect(await ler('inativo')).toMatchObject({ pesavel: 'N' });
    expect(await lerEspelho('e-inativo')).toEqual({ pesavel: 'N', tecla_balanca: '0', validade_balanca: '0' });
    expect(await ler('morto')).toMatchObject({ pesavel: null });
    expect(await ler('li')).toMatchObject({ pesavel: 'N' });
    expect(await lerEspelho('e-li')).toMatchObject({ pesavel: 'N' });
  });

  it('o espelho casado só pelo código de barras também é corrigido', async () => {
    await produto('coca', 'TNP', '13167', { barras: '7894900011517' });
    await espelho('e-barras', 'TNP', '55555', 'N', '0', '0', '7894900011517');
    const r = await aplicar();
    expect(r.espelhosCorrigidos).toBe(1);
    expect(await lerEspelho('e-barras')).toEqual({ pesavel: 'S', tecla_balanca: '000', validade_balanca: '5' });
  });

  it('rodar duas vezes é inofensivo', async () => {
    await produto('a', 'TNP', '13200');
    await aplicar();
    expect(await aplicar()).toMatchObject({ gravados: 0, jaNoPadrao: 1, espelhosCorrigidos: 0 });
  });

  it('recusa frase errada antes de abrir transação', async () => {
    await produto('a', 'TNP', '13200');
    const previa = await service.previa('TNP');
    await expect(service.aplicar('TNP', 'CLASSIFICAR PESAVEL TNP', previa.hashPlano)).rejects.toMatchObject({ statusCode: 400 });
    expect(await ler('a')).toMatchObject({ pesavel: null });
  });

  it('recusa prévia envelhecida quando o cadastro mudou no meio', async () => {
    await produto('a', 'TNP', '13200');
    await produto('b', 'TNP', '13201');
    const previa = await service.previa('TNP');
    await db.execute(sqlTag`UPDATE products SET pesavel = 'N', tecla_balanca = 0, validade_balanca = 0 WHERE id = 'b'`);
    await expect(service.aplicar('TNP', FRASE, previa.hashPlano)).rejects.toMatchObject({ statusCode: 409 });
    expect(await ler('a')).toMatchObject({ pesavel: null });
  });

  it('a frase é da loja: a da TNP não serve para a LI', async () => {
    await produto('li', 'LI', '13200');
    const previa = await service.previa('LI');
    await expect(service.aplicar('LI', FRASE, previa.hashPlano)).rejects.toMatchObject({ statusCode: 400 });
    await service.aplicar('LI', 'TODOS PESAVEIS LI', previa.hashPlano);
    expect(await ler('li')).toMatchObject({ pesavel: 'S', validade_balanca: 5 });
  });
});
