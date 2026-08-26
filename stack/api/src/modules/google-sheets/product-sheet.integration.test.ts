import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { uuidv7 } from 'uuidv7';
import { users } from '@/modules/user/user.table';
import type { CurrentUser } from '@/types/fastify-jwt';
import type { ProductRequests } from '@pralis/shared';
import type { ProductRepository } from '@/modules/product/product.repository';
import type { ProductService } from '@/modules/product/product.service';
import type { ProductSheetRepository } from './product-sheet.repository';
import type { ProductSheetService } from './product-sheet.service';
import { FakeSheetsGateway } from './fake-sheets.gateway';
import type { TaxRuleService } from '@/modules/apoio/tax-rule.service';

/**
 * Postgres REAL (Testcontainers) + Google MOCKADO. Nenhum teste escreve na
 * planilha de verdade.
 *
 * O que este arquivo prova:
 *  - a migration cria product_sheet_sync;
 *  - produto + registro `pending` nascem na MESMA transação;
 *  - falha no Google não desfaz nem esconde o cadastro;
 *  - reprocessar é idempotente (mesma linha, sem duplicar).
 */

let container: StartedPostgreSqlContainer;
let db: {
  insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> };
  execute: (q: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let repo: ProductRepository;
let syncRepo: ProductSheetRepository;
let sheetService: ProductSheetService;
let service: ProductService;
let sheets: FakeSheetsGateway;
let env: {
  GOOGLE_SHEETS_ENABLED: boolean;
  GOOGLE_SHEETS_BASE_TAB: string;
  GOOGLE_SHEETS_SPREADSHEET_ID: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
};
let sqlTag: typeof import('drizzle-orm')['sql'];

const adminId = uuidv7();
const admin: CurrentUser = { id: adminId, name: 'Rodrigo', email: 'admin@test.com', loja: null, role: 'admin' };

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

async function sheetRow(productId: string) {
  const res = await db.execute(
    sqlTag`SELECT product_id, spreadsheet_id, sheet_name, row_number, status, attempts, last_error, synced_at
           FROM product_sheet_sync WHERE product_id = ${productId}`,
  );
  return res.rows?.[0] ?? null;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.VITEST = 'true';

  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const drizzleOrm = await import('drizzle-orm');
  sqlTag = drizzleOrm.sql;
  const dbMod = await import('@/db/databases');
  db = dbMod.db as unknown as typeof db;
  await migrate(dbMod.db, { migrationsFolder: './drizzle' });

  env = (await import('@/config/env')).env as unknown as typeof env;

  const { ProductRepository } = await import('@/modules/product/product.repository');
  const { ProductSheetRepository } = await import('./product-sheet.repository');
  const { ProductSheetService } = await import('./product-sheet.service');
  const { ProductService } = await import('@/modules/product/product.service');

  repo = new ProductRepository();
  syncRepo = new ProductSheetRepository();
  // A planilha real mantém a linha 12 como modelo completo de fórmulas mesmo
  // quando E/CP estão vazios. O fake reproduz esse contrato sem ocupar a linha.
  sheets = new FakeSheetsGateway().comCabecalhos().comLinhaModelo(12);
  sheetService = new ProductSheetService(repo, syncRepo, sheets);
  const taxRules = {
    classify: async (grupo: string) => ({
      grupo, cstPisCofins: '6', tributacaoSimples: 'ALÍQUOTA ZERO',
      aliquotaSimples: 7.4, icmsRe: 0, baseFiscal: 'Cesta básica',
      ncm: null, codigoFiscal: null, produtoFiscal: null, cstReforma: null,
      cClassTrib: null, aliquotaIbs: null, aliquotaCbs: null, origem: 'grupo' as const,
    }),
  } as TaxRuleService;
  service = new ProductService(repo, sheetService, taxRules);

  await db.insert(users).values([
    { id: adminId, name: 'Rodrigo', email: 'admin@test.com', passwordHash: 'x', loja: null, role: 'admin' },
  ]);
}, 120000);

afterAll(async () => {
  await db?.$client?.end().catch(() => {});
  await container?.stop();
});

beforeEach(() => {
  env.GOOGLE_SHEETS_ENABLED = false;
  // ambiente "bem configurado" de mentira — o gateway é falso, nada sai daqui.
  // O destino é explícito porque o código não tem mais ID padrão: sem ele a
  // sincronização é recusada antes de qualquer escrita.
  env.GOOGLE_SHEETS_SPREADSHEET_ID = 'id-de-teste-nao-oficial';
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'teste@exemplo.iam.gserviceaccount.com';
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n';
  sheets.falharEscrita = null;
  sheets.falharTudo = null;
});

describe('product_sheet_sync — migration e transação', () => {
  it('a tabela existe com as colunas da etapa 1', async () => {
    const res = await db.execute(
      sqlTag`SELECT column_name, is_nullable FROM information_schema.columns
             WHERE table_name = 'product_sheet_sync' ORDER BY column_name`,
    );
    const colunas = res.rows.map((r) => String(r.column_name));
    expect(colunas).toEqual([
      'attempts', 'created_at', 'last_error', 'product_id',
      'row_number', 'sheet_name', 'spreadsheet_id', 'status', 'synced_at', 'updated_at',
    ]);
    const nullable = Object.fromEntries(res.rows.map((r) => [r.column_name, r.is_nullable]));
    expect(nullable.row_number).toBe('YES');
    expect(nullable.last_error).toBe('YES');
    expect(nullable.synced_at).toBe('YES');
    expect(nullable.status).toBe('NO');
  });

  it('produto e registro pending nascem na MESMA transação (integração desligada)', async () => {
    const p = await service.create(admin, mkPayload('SYNC PENDING A'));

    expect(p.loja).toBe('BASE');
    expect(p.sheetSync).toBe('disabled');

    const row = await sheetRow(p.id);
    expect(row).toMatchObject({
      product_id: p.id,
      status: 'pending',
      attempts: 0,
      row_number: null,
      last_error: null,
      synced_at: null,
    });
    expect(row!.sheet_name).toBe(env.GOOGLE_SHEETS_BASE_TAB);
  });

  it('se o registro de sincronização falhar, o produto NÃO é criado (tudo ou nada)', async () => {
    const antes = (await repo.list('BASE', {})).length;

    await expect(
      repo.create(
        mkPayload('SYNC ROLLBACK'),
        { loja: 'BASE', codigo: 'PR-RB-0001', createdByUserId: adminId, createdByName: 'Rodrigo' },
        async () => { throw new Error('falha proposital no registro de sincronização'); },
      ),
    ).rejects.toThrow('falha proposital');

    const depois = await repo.list('BASE', {});
    expect(depois.length).toBe(antes);
    expect(depois.some((x) => x.nome === 'SYNC ROLLBACK')).toBe(false);
  });

  it('excluir o produto remove o registro de sincronização (cascade)', async () => {
    const p = await service.create(admin, mkPayload('SYNC CASCADE'));
    expect(await sheetRow(p.id)).not.toBeNull();

    await service.delete(admin, p.id);
    expect(await sheetRow(p.id)).toBeNull();
  });
});

describe('espelhamento com Google mockado (Postgres real)', () => {
  it('cadastro com integração ligada grava a linha e marca synced', async () => {
    env.GOOGLE_SHEETS_ENABLED = true;
    const p = await service.create(admin, mkPayload('SYNC OK A'));

    expect(p.sheetSync).toBe('synced');
    expect(sheets.get('CP11')).toBe(p.id);
    expect(sheets.get('E11')).toBe('SYNC OK A');
    expect(sheets.get('AC11')).toBe(p.codigoInterno);

    const row = await sheetRow(p.id);
    expect(row).toMatchObject({ status: 'synced', row_number: 11, attempts: 1, last_error: null });
    expect(row!.synced_at).not.toBeNull();
  });

  it('falha do Google: produto salvo, status failed, attempts contado, erro sanitizado', async () => {
    env.GOOGLE_SHEETS_ENABLED = true;
    sheets.falharEscrita = new Error('403 The caller does not have permission');

    const p = await service.create(admin, mkPayload('SYNC FALHA B'));

    // o cadastro NÃO falhou
    expect(p.sheetSync).toBe('failed');
    expect(await repo.findById(p.id)).not.toBeNull();

    const row = await sheetRow(p.id);
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    expect(String(row!.last_error)).toContain('403');
    expect(row!.synced_at).toBeNull();
  });

  it('reprocessar depois da falha vira synced na MESMA linha, sem duplicar', async () => {
    env.GOOGLE_SHEETS_ENABLED = true;
    sheets.falharEscrita = new Error('503 Service Unavailable');

    const p = await service.create(admin, mkPayload('SYNC RETRY C'));
    expect(p.sheetSync).toBe('failed');
    // a falha derrubou já a reserva do UUID em CP: nada foi escrito na planilha
    // e o banco NÃO guarda linha que a planilha não confirmou
    expect(await sheetRow(p.id)).toMatchObject({ status: 'failed', row_number: null });

    sheets.falharEscrita = null;
    const primeiro = await sheetService.syncProduct(p.id);
    expect(primeiro.outcome).toBe('synced');
    const linha = primeiro.rowNumber!;
    expect(linha).toBeGreaterThanOrEqual(11);

    // e reprocessar um registro JÁ synced continua idempotente
    const segundo = await sheetService.syncProduct(p.id);
    expect(segundo).toMatchObject({ outcome: 'synced', rowNumber: linha });
    expect(sheets.get(`CP${linha}`)).toBe(p.id);
    expect(sheets.get(`E${linha + 1}`)).toBe(''); // não consumiu a linha seguinte

    const row = await sheetRow(p.id);
    expect(row).toMatchObject({ status: 'synced', row_number: linha, last_error: null });
    expect(Number(row!.attempts)).toBe(3); // 1 falha + 2 sucessos
  });

  it('reprocessa produto criado ANTES da integração existir (sem registro na tabela)', async () => {
    const p = await repo.create(mkPayload('SYNC LEGADO D'), {
      loja: 'BASE', codigo: 'PR-LG-0001', createdByUserId: adminId, createdByName: 'Rodrigo',
    });
    expect(await sheetRow(p.id)).toBeNull();

    env.GOOGLE_SHEETS_ENABLED = true;
    const res = await sheetService.syncProduct(p.id);

    expect(res.outcome).toBe('synced');
    expect(await sheetRow(p.id)).toMatchObject({ status: 'synced', row_number: res.rowNumber });
  });

  it('promoção chega à planilha com desconto NEGATIVO e dias por rótulo', async () => {
    env.GOOGLE_SHEETS_ENABLED = true;
    const payload = mkPayload('SYNC PROMO E');
    payload.promocoes = [{
      tipo: 'desconto', valor: null, descontoPct: 0.2,
      horaInicio: '12:00', horaFim: '15:00',
      dias: [true, false, false, false, false, false, true], // SEG e DOM
      descontoAte: 'ATÉ 20%',
    }];

    const p = await service.create(admin, payload);
    expect(p.sheetSync).toBe('synced');

    const linha = Number((await sheetRow(p.id))!.row_number);
    expect(sheets.get(`AZ${linha}`)).toBe('-0.2'); // AY = (AZ*AO)+AO
    expect(sheets.get(`AU${linha}`)).toBe('SIM');
    expect(sheets.get(`BA${linha}`)).toBe('ATÉ 20%');
    expect(sheets.get(`BB${linha}`)).toBe('SEG');
    expect(sheets.get(`BH${linha}`)).toBe('DOM');
    expect(sheets.get(`BC${linha}`)).toBe(''); // TER inativo fica vazio
    // colunas operacionais preenchidas
    expect(sheets.get(`Q${linha}`)).toBe('SIM');
    expect(sheets.get(`S${linha}`)).toBe('NÃO');
    expect(sheets.get(`AB${linha}`)).toBe('ATIVO');
    expect(sheets.get(`BP${linha}`)).toBe('NÃO REVISADO');
  });

  it('EXCLUIR o produto limpa a linha na planilha e libera o espaço', async () => {
    env.GOOGLE_SHEETS_ENABLED = true;
    const p = await service.create(admin, mkPayload('SYNC DELETE F'));
    expect(p.sheetSync).toBe('synced');
    const linha = Number((await sheetRow(p.id))!.row_number);
    expect(sheets.get(`E${linha}`)).toBe('SYNC DELETE F');

    await service.delete(admin, p.id);

    // sumiu do banco E da planilha
    expect(await repo.findById(p.id)).toBeNull();
    expect(sheets.get(`E${linha}`)).toBe('');
    expect(sheets.get(`CP${linha}`)).toBe('');

    // e a linha volta a ser usada pelo próximo cadastro
    const outro = await service.create(admin, mkPayload('SYNC REUSO G'));
    expect(Number((await sheetRow(outro.id))!.row_number)).toBe(linha);
    expect(sheets.get(`E${linha}`)).toBe('SYNC REUSO G');
  });

  it('falha do Google ao excluir ABORTA a exclusão — o produto continua no banco', async () => {
    env.GOOGLE_SHEETS_ENABLED = true;
    const p = await service.create(admin, mkPayload('SYNC DELETE FALHA H'));
    const linha = Number((await sheetRow(p.id))!.row_number);

    sheets.falharEscrita = new Error('403 The caller does not have permission');
    await expect(service.delete(admin, p.id)).rejects.toMatchObject({ code: 'SHEET_DELETE_FAILED' });

    // nem o banco nem a planilha foram tocados: os dois lados continuam iguais
    expect(await repo.findById(p.id)).not.toBeNull();
    expect(sheets.get(`E${linha}`)).toBe('SYNC DELETE FALHA H');
    expect(sheets.get(`CP${linha}`)).toBe(p.id);
  });

  it('health não escreve nada na planilha', async () => {
    env.GOOGLE_SHEETS_ENABLED = true;
    const escritasAntes = sheets.writes.length;

    const health = await sheetService.health();

    expect(health.ok).toBe(true);
    expect(sheets.writes.length).toBe(escritasAntes);
  });
});
