import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductSheetService } from './product-sheet.service';

/**
 * A fila de reenvio existe para o caso em que o Google falha e ninguém está
 * olhando. O que estes testes guardam é o comportamento que evita os dois
 * extremos: desistir cedo demais e insistir para sempre.
 */
let container: StartedPostgreSqlContainer;
let db: typeof import('@/db/databases')['db'];
let sqlTag: typeof import('drizzle-orm')['sql'];
let ReenvioSheetsService: typeof import('./reenvio.service')['ReenvioSheetsService'];
let TETO_TENTATIVAS: number;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();

  const dbModule = await import('@/db/databases');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  db = dbModule.db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  const mod = await import('./reenvio.service');
  ReenvioSheetsService = mod.ReenvioSheetsService;
  TETO_TENTATIVAS = mod.TETO_TENTATIVAS;
}, 120000);

afterAll(async () => {
  // Fecha o pool ANTES de parar o contêiner: cliente ainda conectado quando o
  // Postgres cai vira `57P01` e faz a rodada inteira sair com erro.
  await db.$client.end();
  await container?.stop();
});

/** Serviço de planilha de mentira: registra quem foi tentado. */
const sheetsFalso = (resultado: 'synced' | 'failed', tentados: string[]) => ({
  async syncProduct(productId: string) {
    tentados.push(productId);
    return { outcome: resultado, rowNumber: 12, message: 'teste' };
  },
}) as unknown as ProductSheetService;

/** Um produto + a linha dele na fila, no estado que o teste precisa. */
async function naFila(id: string, status: string, attempts: number, minutosAtras: number) {
  await db.execute(sqlTag`
    INSERT INTO products (id, codigo, loja, nome, medida_base, tipo, status)
    VALUES (${id}, ${`PR-${id.slice(0, 4)}`}, 'BASE', ${`P-${id.slice(0, 4)}`}, 'UN', 'revenda', 'ativo')
  `);
  await db.execute(sqlTag`
    INSERT INTO product_sheet_sync (product_id, spreadsheet_id, sheet_name, status, attempts, updated_at)
    VALUES (${id}, 'planilha', 'aba', ${status}, ${attempts}, now() - (${minutosAtras} * interval '1 minute'))
  `);
}

const ID = (n: number) => `0000000${n}-0000-7000-8000-00000000000${n}`;

beforeEach(async () => { await db.execute(sqlTag`DELETE FROM products`); });

describe('ReenvioSheetsService', () => {
  it('pega quem falhou e ainda não estourou o teto', async () => {
    await naFila(ID(1), 'failed', 1, 120);
    await naFila(ID(2), 'synced', 1, 120);

    const fila = await new ReenvioSheetsService(sheetsFalso('synced', [])).aguardando();

    expect(fila).toEqual([ID(1)]); // o já sincronizado não volta para a fila
  });

  it('respeita a espera: falhou agora não é tentado de novo agora', async () => {
    await naFila(ID(3), 'failed', 3, 0); // 3 tentativas pedem 4 minutos de espera

    const fila = await new ReenvioSheetsService(sheetsFalso('synced', [])).aguardando();

    expect(fila).toEqual([]);
  });

  it('depois da espera cumprida, volta para a fila', async () => {
    await naFila(ID(4), 'failed', 3, 10); // 10 minutos > os 4 exigidos

    const fila = await new ReenvioSheetsService(sheetsFalso('synced', [])).aguardando();

    expect(fila).toEqual([ID(4)]);
  });

  it('quem bateu o teto sai da fila automática, mas continua contado', async () => {
    await naFila(ID(5), 'failed', TETO_TENTATIVAS, 999);
    const servico = new ReenvioSheetsService(sheetsFalso('synced', []));

    expect(await servico.aguardando()).toEqual([]);
    expect(await servico.desistidos()).toBe(1);
  });

  it('reprocessa e conta o que deu certo', async () => {
    await naFila(ID(6), 'pending', 0, 0);
    const tentados: string[] = [];

    const r = await new ReenvioSheetsService(sheetsFalso('synced', tentados)).reprocessar();

    expect(tentados).toEqual([ID(6)]);
    expect(r).toMatchObject({ tentados: 1, sincronizados: 1, falharam: 0 });
  });

  it('falha na planilha não derruba a rotina — vira contagem', async () => {
    await naFila(ID(7), 'pending', 0, 0);
    const explode = {
      async syncProduct() { throw new Error('Google fora do ar'); },
    } as unknown as ProductSheetService;

    const r = await new ReenvioSheetsService(explode).reprocessar();

    expect(r).toMatchObject({ tentados: 1, sincronizados: 0, falharam: 1 });
  });
});

/**
 * O reenvio precisa terminar o serviço, não metade dele.
 *
 * As abas `(TNP)` e `(LI) CADASTRO PRODUTOS` são cópias linha a linha da aba
 * combinada. Cadastrar e editar já espelhavam nas três; o REENVIO não — ele
 * chamava só `syncProduct` e parava aí. O produto que falhou no Google e voltou
 * pela fila ficava só na combinada, e a próxima linha nova encontrava as abas
 * de loja desalinhadas. É o mesmo defeito que já tinha quebrado a linha 1198,
 * agora pela porta dos fundos.
 */
describe('ReenvioSheetsService — espelho nas abas de loja', () => {
  /** Registra em qual aba cada espelho foi pedido. */
  const espelhoFalso = (registro: Array<{ id: string; linha: number }>) => ({
    async espelharNasAbasDeLoja(itens: Array<{ produto: { id: string }; linha: number }>) {
      for (const i of itens) registro.push({ id: i.produto.id, linha: i.linha });
      return 'espelhado' as const;
    },
  });

  const repoFalso = {
    async findById(id: string) { return { id, loja: 'BASE', nome: `P-${id.slice(0, 4)}` }; },
  };

  it('depois de sincronizar a combinada, espelha nas abas de loja', async () => {
    await naFila(ID(8), 'pending', 0, 0);
    const espelhados: Array<{ id: string; linha: number }> = [];

    const r = await new ReenvioSheetsService(
      sheetsFalso('synced', []),
      espelhoFalso(espelhados) as never,
      repoFalso as never,
    ).reprocessar();

    expect(r).toMatchObject({ sincronizados: 1 });
    // a MESMA linha que a combinada usou — é isso que mantém o alinhamento
    expect(espelhados).toEqual([{ id: ID(8), linha: 12 }]);
  });

  it('não espelha o que não sincronizou — linha errada seria pior que linha nenhuma', async () => {
    await naFila(ID(9), 'pending', 0, 0);
    const espelhados: Array<{ id: string; linha: number }> = [];

    await new ReenvioSheetsService(
      sheetsFalso('failed', []),
      espelhoFalso(espelhados) as never,
      repoFalso as never,
    ).reprocessar();

    expect(espelhados).toEqual([]);
  });

  it('falha no espelho não desfaz a sincronização já contada', async () => {
    await naFila(ID(1), 'pending', 0, 0);
    const espelhoQueExplode = {
      async espelharNasAbasDeLoja() { throw new Error('Google fora do ar'); },
    };

    const r = await new ReenvioSheetsService(
      sheetsFalso('synced', []),
      espelhoQueExplode as never,
      repoFalso as never,
    ).reprocessar();

    // a combinada recebeu o produto; insistir no espelho é trabalho da próxima
    // rodada, não motivo para marcar como falha o que já foi gravado
    expect(r).toMatchObject({ tentados: 1, sincronizados: 1, falharam: 0 });
  });
});
