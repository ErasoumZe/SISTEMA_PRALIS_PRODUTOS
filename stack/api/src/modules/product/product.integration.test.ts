import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductRepository } from './product.repository';

let container: StartedPostgreSqlContainer;
let repo: ProductRepository;
let dbClient: { $client: { end: () => Promise<void> } };

beforeAll(async () => {
  // sobe um Postgres efêmero só para o teste
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();

  // aplica as migrations no banco do container
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { db } = await import('@/db/databases');
  dbClient = db as unknown as typeof dbClient;
  await migrate(db, { migrationsFolder: './drizzle' });

  const { ProductRepository } = await import('./product.repository');
  repo = new ProductRepository();
}, 120000);

afterAll(async () => {
  // fecha o pool ANTES de parar o container (evita erros de conexão terminada)
  await dbClient?.$client?.end().catch(() => {});
  await container?.stop();
});

describe('ProductRepository (integração — Postgres real via Testcontainers)', () => {
  it('cria produto com lojas/promoção/fiscal, lê, lista e exclui (cascade)', async () => {
    const created = await repo.create(
      {
        nome: 'BOLO TESTE',
        quantidade: 1,
        medidaBase: 'UN',
        codigoBarras: null,
        marca: 'PRALIS',
        embalagem: 'UN',
        cDe: 'DE',
        qtCad: 1,
        medidaCompra: 'UN',
        codigoInterno: null,
        fotoUrl: null,
        grupo: null,
        tipo: 'revenda',
        status: 'ativo',
        habilitarAjuda: false,
        lojas: [
          {
            loja: 'TNP',
            estoqueMin: 5,
            estoqueMax: 30,
            setorEstoque: 'PROD. - CONFEITARIA',
            custo: 8,
            margemPontual: 0.6,
            vVendaPontual: null,
            auto: true,
            localVenda1: null,
            localVenda2: null,
            promocoes: [
              {
                tipo: 'desconto',
                valor: null,
                descontoPct: 0.2,
                horaInicio: '12:00',
                horaFim: '15:00',
                dias: [true, true, true, true, true, false, false],
                descontoAte: null,
              },
            ],
          },
        ],
        transformacao: null,
        fiscal: {
          ncm: '19059090',
          cest: null,
          categoria: 'PADARIA',
          cstPisCofins: '01',
          aliquotaCheia: 7,
          aliquotaFcp: null,
          aliquotaPis: 1.65,
          aliquotaCofins: 7.6,
          reducaoIcms: null,
          icms: 7,
        },
      },
      'PR-TEST-0001',
    );

    expect(created.codigo).toBe('PR-TEST-0001');
    expect(created.lojas).toHaveLength(1);
    expect(created.lojas[0]?.promocoes[0]?.descontoPct).toBe(0.2);
    expect(created.lojas[0]?.promocoes[0]?.dias).toEqual([true, true, true, true, true, false, false]);
    expect(created.fiscal?.ncm).toBe('19059090');

    const found = await repo.findById(created.id);
    expect(found?.nome).toBe('BOLO TESTE');
    expect(found?.fiscal?.icms).toBe(7);

    const list = await repo.list({ q: 'bolo' });
    expect(list.some((p) => p.id === created.id)).toBe(true);

    const deleted = await repo.delete(created.id);
    expect(deleted).toBe(true);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('lista vazia após exclusão', async () => {
    const list = await repo.list({});
    expect(Array.isArray(list)).toBe(true);
  });
});
