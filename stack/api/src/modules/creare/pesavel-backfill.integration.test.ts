import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { PesavelBackfillService } from './pesavel-backfill.service';

/**
 * O caminho que grava. O plano tem teste unitário; aqui se prova o que só o
 * banco responde: a transação tudo-ou-nada, a trava pelo hash do estado, e que
 * quem já tem valor, outra loja e cadastro unificado ficam intocados.
 */
let container: StartedPostgreSqlContainer;
let service: PesavelBackfillService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

const FRASE = 'CLASSIFICAR PESAVEL TNP';

async function produto(id: string, loja: string, codigoInterno: string | null, extras: {
  pesavel?: string | null; tecla?: number | null; validade?: number | null; status?: string;
} = {}) {
  await db.execute(sqlTag`
    INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, codigo_interno, pesavel, tecla_balanca, validade_balanca)
    VALUES (${id}, ${loja}, ${id}, ${`PRODUTO ${id}`}, 'UN', 'revenda', ${extras.status ?? 'ativo'},
      ${codigoInterno}, ${extras.pesavel ?? null}, ${extras.tecla ?? null}, ${extras.validade ?? null})
  `);
}

async function espelho(id: string, loja: string, coditem: string, pesavel: string | null, tecla: string | null = null, validade: string | null = null) {
  await db.execute(sqlTag`
    INSERT INTO sia_produto_depara (id, loja, codigo_barras, chave_barras, coditem, pesavel, tecla_balanca, validade_balanca)
    VALUES (${id}, ${loja}, ${`000${coditem}`}, ${`b${loja}${coditem}`}, ${coditem}, ${pesavel}, ${tecla}, ${validade})
  `);
}

const ler = async (id: string) => (await db.execute(sqlTag`
  SELECT pesavel, tecla_balanca, validade_balanca FROM products WHERE id = ${id}
`)).rows[0];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  sqlTag = (await import('drizzle-orm')).sql;
  const database = await import('@/db/databases');
  db = database.db as unknown as typeof db;
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(database.db, { migrationsFolder: './drizzle' });
  const { PesavelBackfillService } = await import('./pesavel-backfill.service');
  service = new PesavelBackfillService();
}, 300_000);

afterAll(async () => {
  await db?.$client.end();
  await container?.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM sia_produto_depara`);
  await db.execute(sqlTag`DELETE FROM products`);
});

describe('prévia', () => {
  it('conta por origem e não grava', async () => {
    await produto('sem-nada', 'TNP', '13200');
    await produto('com-espelho-s', 'TNP', '10001');
    await produto('com-espelho-n', 'TNP', '10002');
    await produto('ja-definido', 'TNP', '10003', { pesavel: 'N' });
    await espelho('e1', 'TNP', '10001', 'S', '000', '3');
    await espelho('e2', 'TNP', '10002', 'N');

    const previa = await service.previa('TNP');
    expect(previa).toMatchObject({
      loja: 'TNP', totalProdutos: 4, gravar: 3, porOrigem: { espelho: 2, padrao: 1 },
      jaDefinidos: 1, conflitos: [], espelhoAmbiguo: [], confirmacao: FRASE,
    });
    expect(previa.amostraPesaveis).toEqual([{ codigoInterno: '10001', nome: 'PRODUTO com-espelho-s', validadeDias: 3 }]);
    expect(await ler('sem-nada')).toMatchObject({ pesavel: null });
  });
});

describe('aplicar', () => {
  const aplicar = async () => {
    const previa = await service.previa('TNP');
    return service.aplicar('TNP', FRASE, previa.hashPlano);
  };

  it('grava o default N onde ninguém diz, e copia o espelho onde ele diz', async () => {
    await produto('sem-nada', 'TNP', '13200');
    await produto('com-espelho-s', 'TNP', '10001');
    await produto('com-espelho-n', 'TNP', '10002');
    await espelho('e1', 'TNP', '10001', 'S', '000', '3');
    await espelho('e2', 'TNP', '10002', 'N');

    const r = await aplicar();
    expect(r).toMatchObject({ gravados: 3, porOrigem: { espelho: 2, padrao: 1 } });
    expect(await ler('sem-nada')).toMatchObject({ pesavel: 'N', tecla_balanca: 0, validade_balanca: 0 });
    expect(await ler('com-espelho-s')).toMatchObject({ pesavel: 'S', tecla_balanca: 0, validade_balanca: 3 });
    expect(await ler('com-espelho-n')).toMatchObject({ pesavel: 'N', tecla_balanca: 0, validade_balanca: 0 });
  });

  it('S já definido sem tecla/validade é completado pelo espelho', async () => {
    await produto('meio-s', 'TNP', '10001', { pesavel: 'S' });
    await espelho('e1', 'TNP', '10001', 'S', '000', '7');
    const r = await aplicar();
    expect(r.completados).toBe(1);
    expect(await ler('meio-s')).toMatchObject({ pesavel: 'S', tecla_balanca: 0, validade_balanca: 7 });
  });

  it('quem já tem valor fica como está, mesmo que o default fosse outro', async () => {
    await produto('ja-s', 'TNP', '10001', { pesavel: 'S', tecla: 0, validade: 5 });
    await aplicar();
    expect(await ler('ja-s')).toMatchObject({ pesavel: 'S', validade_balanca: 5 });
  });

  it('não encosta na outra loja nem no cadastro unificado', async () => {
    await produto('tnp', 'TNP', '13200');
    await produto('li', 'LI', '13200');
    await produto('morto', 'TNP', '13201', { status: 'unificado' });
    await aplicar();
    expect(await ler('tnp')).toMatchObject({ pesavel: 'N' });
    expect(await ler('li')).toMatchObject({ pesavel: null });
    expect(await ler('morto')).toMatchObject({ pesavel: null });
  });

  it('rodar duas vezes é inofensivo', async () => {
    await produto('a', 'TNP', '13200');
    await aplicar();
    const segunda = await aplicar();
    expect(segunda).toMatchObject({ gravados: 0, jaDefinidos: 1 });
  });

  it('conflito entre cadastro e espelho bloqueia o lote inteiro', async () => {
    await produto('conflito', 'TNP', '10001', { pesavel: 'N' });
    await produto('inocente', 'TNP', '13200');
    await espelho('e1', 'TNP', '10001', 'S', '000', '0');
    const previa = await service.previa('TNP');
    expect(previa.conflitos).toHaveLength(1);
    await expect(service.aplicar('TNP', FRASE, previa.hashPlano)).rejects.toMatchObject({ code: 'PESAVEL_BACKFILL_CONFLITO' });
    // tudo ou nada: o inocente também não foi gravado
    expect(await ler('inocente')).toMatchObject({ pesavel: null });
  });

  it('recusa frase errada antes de abrir transação', async () => {
    await produto('a', 'TNP', '13200');
    const previa = await service.previa('TNP');
    await expect(service.aplicar('TNP', 'classificar', previa.hashPlano)).rejects.toMatchObject({ statusCode: 400 });
    expect(await ler('a')).toMatchObject({ pesavel: null });
  });

  it('recusa prévia envelhecida quando o cadastro mudou no meio', async () => {
    await produto('a', 'TNP', '13200');
    await produto('b', 'TNP', '13201');
    const previa = await service.previa('TNP');
    await db.execute(sqlTag`UPDATE products SET pesavel = 'S', tecla_balanca = 0, validade_balanca = 1 WHERE id = 'b'`);
    await expect(service.aplicar('TNP', FRASE, previa.hashPlano)).rejects.toMatchObject({ statusCode: 409 });
    expect(await ler('a')).toMatchObject({ pesavel: null });
  });

  it('a frase é da loja: a da TNP não serve para a LI', async () => {
    await produto('li', 'LI', '13200');
    const previa = await service.previa('LI');
    await expect(service.aplicar('LI', FRASE, previa.hashPlano)).rejects.toMatchObject({ statusCode: 400 });
    await service.aplicar('LI', 'CLASSIFICAR PESAVEL LI', previa.hashPlano);
    expect(await ler('li')).toMatchObject({ pesavel: 'N' });
  });
});
