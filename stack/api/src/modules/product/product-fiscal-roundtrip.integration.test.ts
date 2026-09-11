import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductRequests } from '@pralis/shared';

/**
 * O bloco fiscal precisa VOLTAR do banco igual ao que entrou.
 *
 * Este teste existe por um defeito real: `aliquotaEcf` e `aliquotaEcfId`
 * estavam fixos em `null` no repositório, tanto na gravação quanto na leitura.
 * O `tsc` não acusa — `null` é valor válido num campo anulável — e nenhum teste
 * cobria a travessia. Resultado: a busca no cadastro de ECF funcionava, achava
 * o produto, e o valor se perdia no caminho para o Postgres.
 *
 * Campo fiscal que não sobrevive ao round-trip é pior que campo ausente: a tela
 * mostra a classificação certa no momento do salvamento e o dado some depois.
 */
let container: StartedPostgreSqlContainer;
let db: typeof import('@/db/databases')['db'];
let sqlTag: typeof import('drizzle-orm')['sql'];
let repo: InstanceType<typeof import('./product.repository')['ProductRepository']>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();

  const dbModule = await import('@/db/databases');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  db = dbModule.db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  const { ProductRepository } = await import('./product.repository');
  repo = new ProductRepository();
}, 120000);

afterAll(async () => {
  await db.$client.end();
  await container?.stop();
});

beforeEach(async () => { await db.execute(sqlTag`DELETE FROM products`); });

/** Bloco fiscal completo, como o cadastro de ECF o entrega. */
const fiscalCompleto: ProductRequests.CreateProductRequest['fiscal'] = {
  ncm: '19059090',
  cest: '1711500',
  categoria: 'PRODUTOS DA CASA (ALIQUOTA EFETIVA)',
  cstPisCofins: '1',
  aliquotaCheia: 18,
  aliquotaFcp: 0,
  aliquotaPis: 0,
  aliquotaCofins: 0,
  reducaoIcms: 53.33,
  icms: 0,
  tributacaoSimples: 'TRIBUTADO INTEGRAL',
  aliquotaSimples: 11.28,
  icmsRe: 3.69,
  baseFiscal: 'Regra geral',
  codigoFiscal: null,
  produtoFiscal: null,
  cstReforma: '000',
  cClassTrib: '000001',
  aliquotaIbs: 0.1,
  aliquotaCbs: 0.9,
  origemFiscal: 'grupo',
  aliquotaEcf: '18,00%',
  aliquotaEcfId: '03',
  estado: 'completo',
  motivo: 'Fiscal completo.',
} as ProductRequests.CreateProductRequest['fiscal'];

const novoProduto = (fiscal: ProductRequests.CreateProductRequest['fiscal']) => ({
  nome: 'BOLO REDONDO LARANJA',
  quantidade: 1,
  medidaBase: 'UN',
  qtCad: 1,
  tipo: 'revenda' as const,
  status: 'ativo' as const,
  grupo: 'MER PADARIA',
  auto: false,
  habilitarAjuda: false,
  fiscal,
}) as unknown as ProductRequests.CreateProductRequest;

describe('bloco fiscal — travessia até o Postgres e de volta', () => {
  it('todo campo fiscal volta igual ao que entrou', async () => {
    const criado = await repo.create(
      novoProduto(fiscalCompleto),
      { loja: 'BASE', codigo: 'PR-RT01', createdByUserId: null, createdByName: 'teste' },
    );

    const lido = await repo.findById(criado.id);

    // campo a campo: um `null` fixo no repositório passava despercebido quando
    // o teste olhava só alguns
    for (const [campo, esperado] of Object.entries(fiscalCompleto!)) {
      expect(
        (lido!.fiscal as unknown as Record<string, unknown>)[campo],
        `campo fiscal "${campo}" não sobreviveu à ida e volta`,
      ).toEqual(esperado);
    }
  });

  it('alíquota de ECF é TEXTO: "SUBST TRIB" e o zero do ID sobrevivem', async () => {
    const criado = await repo.create(
      novoProduto({ ...fiscalCompleto!, aliquotaEcf: 'SUBST TRIB', aliquotaEcfId: '03' }),
      { loja: 'BASE', codigo: 'PR-RT02', createdByUserId: null, createdByName: 'teste' },
    );

    const lido = await repo.findById(criado.id);

    expect(lido!.fiscal!.aliquotaEcf).toBe('SUBST TRIB');
    expect(lido!.fiscal!.aliquotaEcfId).toBe('03'); // não pode virar 3
  });

  it('zero fiscal de verdade é zero, e não vira ausência', async () => {
    const criado = await repo.create(
      novoProduto({ ...fiscalCompleto!, aliquotaFcp: 0, icms: 0, reducaoIcms: 0 }),
      { loja: 'BASE', codigo: 'PR-RT03', createdByUserId: null, createdByName: 'teste' },
    );

    const lido = await repo.findById(criado.id);

    expect(lido!.fiscal!.aliquotaFcp).toBe(0);
    expect(lido!.fiscal!.icms).toBe(0);
    expect(lido!.fiscal!.reducaoIcms).toBe(0);
  });

  it('estado e motivo da pendência sobrevivem ao salvamento', async () => {
    const criado = await repo.create(
      novoProduto({
        ...fiscalCompleto!,
        estado: 'pendente_sem_correspondencia',
        motivo: 'Este produto não existe no cadastro de ECF.',
      }),
      { loja: 'BASE', codigo: 'PR-RT04', createdByUserId: null, createdByName: 'teste' },
    );

    const lido = await repo.findById(criado.id);

    expect(lido!.fiscal!.estado).toBe('pendente_sem_correspondencia');
    expect(lido!.fiscal!.motivo).toContain('não existe no cadastro de ECF');

    // e a data da tentativa fica registrada: separa "nunca tentei" de
    // "tentei e não havia fonte"
    const r = await db.execute(sqlTag`SELECT conferido_em FROM product_fiscal WHERE product_id = ${criado.id}`);
    expect((r.rows[0] as { conferido_em: unknown }).conferido_em).not.toBeNull();
  });
});
