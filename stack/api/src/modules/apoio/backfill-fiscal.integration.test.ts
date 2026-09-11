import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TaxRuleService, ResultadoFiscal } from './tax-rule.service';
import type { ProductRepository } from '@/modules/product/product.repository';
import type { ProductSheetRepository } from '@/modules/google-sheets/product-sheet.repository';

/**
 * O backfill reescreve fiscal em massa. O que estes testes guardam é o
 * contrário do "funcionou": que ele NÃO escreve por padrão, que rodar duas
 * vezes não degrada nada, e que a retomada não repete nem pula.
 */
let container: StartedPostgreSqlContainer;
let db: typeof import('@/db/databases')['db'];
let sqlTag: typeof import('drizzle-orm')['sql'];
let BackfillFiscalService: typeof import('./backfill-fiscal.service')['BackfillFiscalService'];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const dbModule = await import('@/db/databases');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  db = dbModule.db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });
  ({ BackfillFiscalService } = await import('./backfill-fiscal.service'));
}, 120000);

afterAll(async () => {
  await db.$client.end();
  await container?.stop();
});

const REGRA = {
  grupo: 'MER PADARIA', cstPisCofins: '1', tributacaoSimples: 'TRIBUTADO INTEGRAL',
  aliquotaSimples: 11.28, icmsRe: 3.69, baseFiscal: 'Regra geral', margemPadrao: null,
  ncm: '19059090', codigoFiscal: null, produtoFiscal: null, cstReforma: null,
  cClassTrib: null, aliquotaIbs: null, aliquotaCbs: null, origem: 'grupo' as const,
  ecf: {
    reducaoIcms: 53.33, aliquotaCheia: 18, aliquotaFcp: 0, aliquotaPis: 0, aliquotaCofins: 0,
    aliquotaEcf: '18,00%', aliquotaEcfId: '03', categoria: 'PRODUTOS DA CASA',
    icms: null, cest: null, ncm: '19059090', cstEcf: '1', pctNcm: null,
  },
};

/** Motor de mentira: devolve o resultado que o teste quer, e conta chamadas. */
const motor = (resultado: Partial<ResultadoFiscal>, chamadas: string[] = []) => ({
  async classificar(entrada: { nome?: string | null }) {
    chamadas.push(entrada.nome ?? '');
    return {
      estado: 'completo', motivo: 'Fiscal completo.',
      classificacao: REGRA, conflitos: [], ...resultado,
    } as ResultadoFiscal;
  },
}) as unknown as TaxRuleService;

const semSync = { async ensurePending() {} } as unknown as ProductSheetRepository;
const semRepo = {} as unknown as ProductRepository;

const criar = async (id: string, nome: string, grupo = 'MER PADARIA') => {
  await db.execute(sqlTag`
    INSERT INTO products (id, codigo, loja, nome, medida_base, tipo, status, grupo)
    VALUES (${id}, ${`PR-${id.slice(0, 4)}`}, 'BASE', ${nome}, 'UN', 'revenda', 'ativo', ${grupo})
  `);
};

const ID = (n: number) => `0000000${n}-0000-7000-8000-00000000000${n}`;

beforeEach(async () => { await db.execute(sqlTag`DELETE FROM products`); });

describe('BackfillFiscalService', () => {
  it('por padrão NÃO escreve: relata o que faria', async () => {
    await criar(ID(1), 'BOLO REDONDO LARANJA');
    const s = new BackfillFiscalService(motor({}), semRepo, semSync);

    const r = await s.executar({});

    expect(r.aplicou).toBe(false);
    expect(r.alterados).toHaveLength(1);
    const linhas = await db.execute(sqlTag`SELECT count(*)::int AS n FROM product_fiscal`);
    expect((linhas.rows[0] as { n: number }).n).toBe(0); // nada gravado
  });

  it('com --apply grava a carga e o estado', async () => {
    await criar(ID(2), 'BOLO REDONDO LARANJA');
    const s = new BackfillFiscalService(motor({}), semRepo, semSync);

    await s.executar({}, true);

    const r = await db.execute(sqlTag`
      SELECT estado, aliquota_ecf, aliquota_ecf_id, aliquota_cheia, reducao_icms
      FROM product_fiscal WHERE product_id = ${ID(2)}
    `);
    expect(r.rows[0]).toMatchObject({
      estado: 'completo', aliquota_ecf: '18,00%', aliquota_ecf_id: '03',
    });
  });

  it('rodar duas vezes não muda nada na segunda: já está completo', async () => {
    await criar(ID(3), 'BOLO REDONDO LARANJA');
    const s = new BackfillFiscalService(motor({}), semRepo, semSync);

    await s.executar({}, true);
    const segunda = await s.executar({}, true);

    // `completo` não pede nova tentativa, então nem entra na fila
    expect(segunda.analisados).toBe(0);
    expect(segunda.alterados).toEqual([]);
  });

  it('grupo inválido vira pendência gravada, não sucesso', async () => {
    await criar(ID(4), 'QUALQUER', 'SORVETES');
    const s = new BackfillFiscalService(
      motor({ estado: 'pendente_grupo_invalido', motivo: 'grupo fora das regras', classificacao: null }),
      semRepo, semSync,
    );

    await s.executar({}, true);

    const r = await db.execute(sqlTag`SELECT estado, motivo FROM product_fiscal WHERE product_id = ${ID(4)}`);
    expect(r.rows[0]).toMatchObject({ estado: 'pendente_grupo_invalido' });
  });

  it('retomada pelo cursor não repete nem pula', async () => {
    await criar(ID(5), 'A');
    await criar(ID(6), 'B');
    await criar(ID(7), 'C');
    const vistos: string[] = [];
    const s = new BackfillFiscalService(motor({}, vistos), semRepo, semSync);

    const p1 = await s.executar({ limite: 2 });
    const p2 = await s.executar({ limite: 2, cursor: p1.proximoCursor! });

    expect(p1.analisados).toBe(2);
    expect(p2.analisados).toBe(1);
    expect(vistos).toEqual(['A', 'B', 'C']); // cada um uma vez só
  });

  it('só o produto pedido, quando o canário aponta um id', async () => {
    await criar(ID(8), 'ALVO');
    await criar(ID(9), 'OUTRO');
    const vistos: string[] = [];
    const s = new BackfillFiscalService(motor({}, vistos), semRepo, semSync);

    await s.executar({ productId: ID(8) });

    expect(vistos).toEqual(['ALVO']);
  });

  it('o panorama conta por estado, inclusive quem nem tem registro', async () => {
    await criar(ID(1), 'SEM REGISTRO');
    const s = new BackfillFiscalService(motor({}), semRepo, semSync);

    expect(await s.panorama()).toMatchObject({ sem_registro: 1 });
  });
});
