import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { uuidv7 } from 'uuidv7';
import { users } from '@/modules/user/user.table';
import type { CurrentUser } from '@/types/fastify-jwt';
import type { ProductRepository } from './product.repository';
import type { ProductService } from './product.service';
import type { ProductRequests } from '@pralis/shared';
import type { TaxRuleService } from '@/modules/apoio/tax-rule.service';
import type { ProductSheetLojaService } from '@/modules/google-sheets/product-sheet-loja.service';

let container: StartedPostgreSqlContainer;
let repo: ProductRepository;
let service: ProductService;
let db: { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> }; $client: { end: () => Promise<void> } };
let backfill: (db?: unknown) => Promise<{ base: number; orfaos: number }>;

// usuários reais (createdByUserId é FK para users)
const adminId = uuidv7();
const joseId = uuidv7();
const liaId = uuidv7();

const admin: CurrentUser = { id: adminId, name: 'Rodrigo', email: 'admin@test.com', loja: null, role: 'admin' };
const jose: CurrentUser = { id: joseId, name: 'Jose', email: 'jose@tnp.com', loja: 'TNP', role: 'user' };
const lia: CurrentUser = { id: liaId, name: 'Lia', email: 'lia@li.com', loja: 'LI', role: 'user' };

/** payload mínimo válido de produto de revenda, com nome único para não bater no antiduplicado. */
function mkPayload(nome: string): ProductRequests.CreateProductRequest {
  return {
    nome, quantidade: 1, medidaBase: 'UN', codigoBarras: null, marca: 'PRALIS',
    embalagem: 'UN', cDe: 'DE', qtCad: 1, medidaCompra: 'UN',
    codigoInterno: null, fotoUrl: null, grupo: 'MER FAB. PRÓPRIA - PANIFICAÇÃO', tipo: 'revenda', status: 'ativo',
    habilitarAjuda: false, estoqueMin: 5, estoqueMax: 30, setorEstoque: 'PROD. - CONFEITARIA',
    custo: 8, margemPontual: 0.6, vVendaPontual: null, auto: true, localVenda1: null, localVenda2: null,
    promocoes: [], transformacao: null, fiscal: null,
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.VITEST = 'true'; // impede o backfill de auto-executar ao ser importado
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const dbMod = await import('@/db/databases');
  db = dbMod.db as unknown as typeof db;
  await migrate(dbMod.db, { migrationsFolder: './drizzle' });

  const { ProductRepository } = await import('./product.repository');
  const { ProductService } = await import('./product.service');
  const { ProductSheetRepository } = await import('@/modules/google-sheets/product-sheet.repository');
  const { ProductSheetService } = await import('@/modules/google-sheets/product-sheet.service');
  const { FakeSheetsGateway } = await import('@/modules/google-sheets/fake-sheets.gateway');
  repo = new ProductRepository();
  // governança não testa planilha: Google mockado e integração desligada por env
  const sheetService = new ProductSheetService(repo, new ProductSheetRepository(), new FakeSheetsGateway());
  const regraFalsa = (grupo: string) => ({
    grupo, cstPisCofins: '6', tributacaoSimples: 'ALÍQUOTA ZERO',
    aliquotaSimples: 7.4, icmsRe: 0, baseFiscal: 'Cesta básica', margemPadrao: null,
    ncm: null, codigoFiscal: null, produtoFiscal: null, cstReforma: null,
    cClassTrib: null, aliquotaIbs: null, aliquotaCbs: null, origem: 'grupo' as const,
    ecf: null,
  });
  const taxRules = {
    classify: async (grupo: string) => regraFalsa(grupo),
    classificar: async (entrada: { grupo?: string | null }) => ({
      estado: 'parcial' as const,
      motivo: 'sem cadastro de ECF neste teste',
      classificacao: regraFalsa(entrada.grupo ?? ''),
      conflitos: [],
    }),
  } as unknown as TaxRuleService;
  // espelho das abas de loja desligado: teste de integração não fala com o Google
  const espelhoLoja = {
    async espelharVarios() { return 'desligado' as const; },
  } as unknown as ProductSheetLojaService;
  service = new ProductService(repo, sheetService, espelhoLoja, taxRules);
  backfill = (await import('@/db/backfill-codigo-interno')).backfillCodigoInterno as typeof backfill;

  // cria os usuários referenciados pelos produtos (createdByUserId é FK)
  await db.insert(users).values([
    { id: adminId, name: 'Rodrigo', email: 'admin@test.com', passwordHash: 'x', loja: null, role: 'admin' },
    { id: joseId, name: 'Jose', email: 'jose@tnp.com', passwordHash: 'x', loja: 'TNP', role: 'user' },
    { id: liaId, name: 'Lia', email: 'lia@li.com', passwordHash: 'x', loja: 'LI', role: 'user' },
  ]);
}, 120000);

afterAll(async () => {
  await db?.$client?.end().catch(() => {});
  await container?.stop();
});

describe('Governança (autorização) — quem pode criar/editar/excluir', () => {
  it('admin cria sempre na BASE; colaborador NÃO cria (403)', async () => {
    const p = await service.create(admin, mkPayload('PRODUTO ADMIN A'));
    expect(p.loja).toBe('BASE');
    expect(p.createdByName).toBe('Rodrigo');
    expect(p.fiscal).toMatchObject({
      cstPisCofins: '6', tributacaoSimples: 'ALÍQUOTA ZERO',
      aliquotaSimples: 7.4, icmsRe: 0, baseFiscal: 'Cesta básica',
    });

    await expect(service.create(jose, mkPayload('PRODUTO DO JOSE'))).rejects.toMatchObject({
      statusCode: 403,
      code: 'ONLY_ADMIN_CREATE',
    });
  });

  it('colaborador edita produto da PRÓPRIA loja, mas NÃO de outra (403)', async () => {
    const base = await service.create(admin, mkPayload('PRODUTO PARA IMPORTAR'));

    // jose importa para a TNP e edita a cópia dele
    expect(await service.importFromBase(jose, [base.id])).toMatchObject({ imported: 1 });
    const copiaTNP = (await repo.list('TNP', {})).find((x) => x.baseProductId === base.id)!;
    expect(copiaTNP).toBeTruthy();
    const editado = await service.update(jose, copiaTNP.id, { custo: 99 });
    expect(editado.custo).toBe(99);

    // lia importa o mesmo produto para a LI; jose (TNP) NÃO pode editar a cópia da LI
    expect(await service.importFromBase(lia, [base.id])).toMatchObject({ imported: 1 });
    const copiaLI = (await repo.list('LI', {})).find((x) => x.baseProductId === base.id)!;
    await expect(service.update(jose, copiaLI.id, { custo: 1 })).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('exclusão é exclusiva do admin (colaborador 403; admin ok)', async () => {
    const base = await service.create(admin, mkPayload('PRODUTO PARA EXCLUIR'));
    await service.importFromBase(jose, [base.id]);
    const copiaTNP = (await repo.list('TNP', {})).find((x) => x.baseProductId === base.id)!;

    await expect(service.delete(jose, copiaTNP.id)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ONLY_ADMIN_DELETE',
    });

    // A exclusão devolve como terminou a limpeza das abas de loja, igual à
    // edição devolve `espelhoLoja`. Aqui a planilha está desligada por env: não
    // há linha liberada na aba combinada, logo não há linha a limpar nas cópias.
    await expect(service.delete(admin, copiaTNP.id)).resolves.toEqual({ espelhoLoja: 'sem-aba' });
    expect(await repo.findById(copiaTNP.id)).toBeNull();
  });
});

describe('Código interno — sequencial, herança e backfill', () => {
  it('admin gera códigos sequenciais na BASE', async () => {
    const a = await service.create(admin, mkPayload('CODIGO SEQ A'));
    const b = await service.create(admin, mkPayload('CODIGO SEQ B'));
    expect(a.codigoInterno).toMatch(/^\d{5}$/);
    expect(b.codigoInterno).toMatch(/^\d{5}$/);
    // o segundo é exatamente o primeiro + 1
    expect(Number(b.codigoInterno)).toBe(Number(a.codigoInterno) + 1);
  });

  it('importação herda o MESMO código interno da base (igual entre lojas)', async () => {
    const base = await service.create(admin, mkPayload('CODIGO HERANCA'));
    await service.importFromBase(jose, [base.id]);
    const copia = (await repo.list('TNP', {})).find((x) => x.baseProductId === base.id)!;
    expect(copia.codigoInterno).toBe(base.codigoInterno);
  });

  it('backfill dá código próprio a produto órfão (criado direto na loja, sem base)', async () => {
    // simula legado: produto direto na loja, sem base e sem código interno
    const orfao = await repo.create(mkPayload('ORFAO LEGADO'), {
      loja: 'TNP', codigo: 'PR-ORF-0001', createdByUserId: joseId, createdByName: 'Jose', codigoInterno: null,
    });
    expect(orfao.codigoInterno).toBeNull();

    const res = await backfill(db);
    expect(res.orfaos).toBeGreaterThanOrEqual(1);

    const depois = await repo.findById(orfao.id);
    expect(depois?.codigoInterno).toMatch(/^\d{5}$/);
  });
});

describe('Seed da BASE — código interno na criação', () => {
  it('produto criado como o seed faz JÁ nasce com código interno', async () => {
    // Reproduz exatamente a chamada do seed-base.ts. Antes ele omitia
    // codigoInterno e o produto ficava null até o backfill rodar; nessa janela
    // o espelho na planilha gravava a coluna CODIGO INT. vazia para sempre.
    const criado = await repo.create(mkPayload('SEED COM CODIGO'), {
      loja: 'BASE',
      codigo: 'PR-SEED-0001',
      codigoInterno: await repo.proximoCodigoInterno(),
      createdByUserId: null,
      createdByName: 'Sistema (planilha base)',
    });

    expect(criado.codigoInterno).toMatch(/^\d{5}$/);
    expect(criado.codigoInterno).not.toBeNull();

    // e o próximo produto continua a sequência, sem repetir
    const seguinte = await repo.create(mkPayload('SEED COM CODIGO 2'), {
      loja: 'BASE',
      codigo: 'PR-SEED-0002',
      codigoInterno: await repo.proximoCodigoInterno(),
      createdByUserId: null,
      createdByName: 'Sistema (planilha base)',
    });
    expect(Number(seguinte.codigoInterno)).toBe(Number(criado.codigoInterno) + 1);
  });

  it('o código interno do produto chega na planilha (coluna AC)', async () => {
    const { mapProductToCells } = await import('@/modules/google-sheets/product-sheet.mapper');
    const p = await repo.create(mkPayload('SEED NA PLANILHA'), {
      loja: 'BASE',
      codigo: 'PR-SEED-0003',
      codigoInterno: await repo.proximoCodigoInterno(),
      createdByUserId: null,
      createdByName: 'Sistema (planilha base)',
    });

    const cells = mapProductToCells(p, { defaultLojas: 'TNP,LI,HORA' });
    expect(cells.AC).toEqual({ kind: 'text', value: p.codigoInterno });
    // era isto que ficava vazio na planilha quando o seed omitia o código
    expect(cells.AC).not.toEqual({ kind: 'empty' });
  });
});

describe('Herança BASE -> lojas (Postgres real)', () => {
  it('as lojas herdam o que seguiam; o campo que a loja editou é preservado', async () => {
    const base = await service.create(admin, mkPayload('HERANCA REAL'));
    await service.importFromBase(jose, [base.id]);
    await service.importFromBase(lia, [base.id]);
    const tnp = (await repo.list('TNP', {})).find((x) => x.baseProductId === base.id)!;
    const li = (await repo.list('LI', {})).find((x) => x.baseProductId === base.id)!;

    // a TNP passa a ter custo PRÓPRIO; a LI continua seguindo a BASE
    await service.update(jose, tnp.id, { custo: 99 });

    const r = await service.update(admin, base.id, { nome: 'HERANCA REAL EDITADA', custo: 42 });
    expect(r.lojasAtualizadas).toBe(2);

    const tnpDepois = (await repo.findById(tnp.id))!;
    const liDepois = (await repo.findById(li.id))!;

    // nome: as duas seguiam -> as duas herdaram (cadastro igual entre lojas)
    expect(tnpDepois.nome).toBe('HERANCA REAL EDITADA');
    expect(liDepois.nome).toBe('HERANCA REAL EDITADA');

    // custo: a TNP tinha valor próprio -> preservado; a LI seguia -> herdou
    expect(Number(tnpDepois.custo)).toBe(99);
    expect(Number(liDepois.custo)).toBe(42);
  });

  it('promoção é da loja: a da BASE não desce e a da loja não é apagada', async () => {
    const base = await service.create(admin, mkPayload('HERANCA PROMO'));
    await service.importFromBase(jose, [base.id]);
    const tnp = (await repo.list('TNP', {})).find((x) => x.baseProductId === base.id)!;

    await service.update(jose, tnp.id, {
      promocoes: [{
        tipo: 'desconto', valor: null, descontoPct: 0.15, horaInicio: null, horaFim: null,
        dias: [true, false, false, false, false, false, false], descontoAte: null,
      }],
    });

    await service.update(admin, base.id, {
      nome: 'HERANCA PROMO EDITADA',
      promocoes: [{
        tipo: 'desconto', valor: null, descontoPct: 0.5, horaInicio: null, horaFim: null,
        dias: [false, false, false, false, false, false, true], descontoAte: null,
      }],
    });

    const tnpDepois = (await repo.findById(tnp.id))!;
    expect(tnpDepois.nome).toBe('HERANCA PROMO EDITADA');          // cadastro herdou
    expect(tnpDepois.promocoes).toHaveLength(1);
    expect(Number(tnpDepois.promocoes[0]!.descontoPct)).toBe(0.15); // a promo da loja ficou
  });

  it('editar produto de LOJA não mexe na BASE nem na outra loja', async () => {
    const base = await service.create(admin, mkPayload('HERANCA ISOLADA'));
    await service.importFromBase(jose, [base.id]);
    await service.importFromBase(lia, [base.id]);
    const tnp = (await repo.list('TNP', {})).find((x) => x.baseProductId === base.id)!;
    const li = (await repo.list('LI', {})).find((x) => x.baseProductId === base.id)!;

    const r = await service.update(jose, tnp.id, { nome: 'SO DA TNP' });
    expect(r.lojasAtualizadas).toBe(0);

    expect((await repo.findById(base.id))!.nome).toBe('HERANCA ISOLADA');
    expect((await repo.findById(li.id))!.nome).toBe('HERANCA ISOLADA');
  });
});
