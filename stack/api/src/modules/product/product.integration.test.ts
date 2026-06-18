import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductRepository } from './product.repository';

let container: StartedPostgreSqlContainer;
let repo: ProductRepository;
let dbClient: { $client: { end: () => Promise<void> } };

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { db } = await import('@/db/databases');
  dbClient = db as unknown as typeof dbClient;
  await migrate(db, { migrationsFolder: './drizzle' });
  const { ProductRepository } = await import('./product.repository');
  repo = new ProductRepository();
}, 120000);

afterAll(async () => {
  await dbClient?.$client?.end().catch(() => {});
  await container?.stop();
});

const payload = {
  nome: 'BOLO TESTE', quantidade: 1, medidaBase: 'UN' as const, codigoBarras: '789', marca: 'PRALIS',
  embalagem: 'UN' as const, cDe: 'DE' as const, qtCad: 1, medidaCompra: 'UN' as const,
  codigoInterno: null, fotoUrl: null, grupo: null, tipo: 'revenda' as const, status: 'ativo' as const,
  habilitarAjuda: false, estoqueMin: 5, estoqueMax: 30, setorEstoque: 'PROD. - CONFEITARIA',
  custo: 8, margemPontual: 0.6, vVendaPontual: null, auto: true, localVenda1: null, localVenda2: null,
  promocoes: [{ tipo: 'desconto' as const, valor: null, descontoPct: 0.2, horaInicio: '12:00', horaFim: '15:00', dias: [true, true, true, true, true, false, false], descontoAte: null }],
  transformacao: null,
  fiscal: { ncm: '19059090', cest: null, categoria: 'PADARIA', cstPisCofins: '01', aliquotaCheia: 7, aliquotaFcp: null, aliquotaPis: 1.65, aliquotaCofins: 7.6, reducaoIcms: null, icms: 7 },
};

describe('ProductRepository multi-loja (Postgres real via Testcontainers)', () => {
  it('cria na loja TNP, lê, lista por loja (isolado), detecta duplicado, exclui', async () => {
    const created = await repo.create(payload, { loja: 'TNP', codigo: 'PR-TEST-0001', createdByUserId: null, createdByName: 'José' });
    expect(created.loja).toBe('TNP');
    expect(created.codigo).toBe('PR-TEST-0001');
    expect(created.createdByName).toBe('José');
    expect(created.custo).toBe(8);
    expect(created.promocoes[0]?.descontoPct).toBe(0.2);
    expect(created.fiscal?.ncm).toBe('19059090');

    // aparece na TNP, não na LI (isolamento por loja)
    expect((await repo.list('TNP', {})).some((p) => p.id === created.id)).toBe(true);
    expect((await repo.list('LI', {})).some((p) => p.id === created.id)).toBe(false);

    // duplicado por NOME (case-insensitive)
    const dupNome = await repo.findDuplicate('TNP', 'bolo teste', null);
    expect(dupNome?.id).toBe(created.id);
    expect(dupNome?.createdByName).toBe('José');

    // duplicado por CÓDIGO DE BARRAS
    const dupCod = await repo.findDuplicate('TNP', 'NOME DIFERENTE', '789');
    expect(dupCod?.id).toBe(created.id);

    // não é duplicado em outra loja
    expect(await repo.findDuplicate('LI', 'bolo teste', '789')).toBeNull();

    expect(await repo.delete(created.id)).toBe(true);
    expect(await repo.findById(created.id)).toBeNull();
  });
});
