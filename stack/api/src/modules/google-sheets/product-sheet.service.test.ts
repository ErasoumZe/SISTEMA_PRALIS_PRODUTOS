import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ProductSchemas } from '@pralis/shared';
import { env } from '@/config/env';
import type { ProductRepository } from '@/modules/product/product.repository';
import { ProductSheetService } from './product-sheet.service';
import type { ProductSheetRepository } from './product-sheet.repository';
import { FakeSheetsGateway } from './fake-sheets.gateway';

type Product = ProductSchemas.ProductEntity;

const ID = '0197d7c4-2c9a-7000-8000-000000000001';
const OUTRO_ID = '0197d7c4-2c9a-7000-8000-000000000002';

function produto(over: Partial<Product> = {}): Product {
  return {
    id: ID,
    codigo: 'PR-AB12-CD34',
    loja: 'BASE',
    baseProductId: null,
    createdByName: 'Rodrigo',
    createdAt: '2026-08-18T12:00:00.000Z',
    nome: 'PAO FRANCES',
    quantidade: 50,
    medidaBase: 'G',
    codigoBarras: '07891234000019', // com zero à esquerda de propósito
    marca: 'PRALIS',
    embalagem: 'UN',
    cDe: 'DE',
    qtCad: 1,
    medidaCompra: 'UN',
    codigoInterno: '00042',
    fotoUrl: null,
    grupo: 'MER PADARIA',
    tipo: 'revenda',
    status: 'ativo',
    habilitarAjuda: false,
    estoqueMin: 10,
    estoqueMax: 50,
    setorEstoque: 'PROD. - PANIFICAÇÃO',
    custo: 0.5,
    margemPontual: 0.7,
    vVendaPontual: null,
    auto: true,
    localVenda1: null,
    localVenda2: null,
    promocoes: [],
    transformacao: null,
    fiscal: null,
    ...over,
  } as Product;
}

/** Registro em memória equivalente a product_sheet_sync. */
interface FakeRow {
  productId: string;
  status: 'pending' | 'synced' | 'failed';
  rowNumber: number | null;
  attempts: number;
  lastError: string | null;
}

function fakeSyncRepo() {
  const rows = new Map<string, FakeRow>();
  const repo = {
    async ensurePending({ productId }: { productId: string }) {
      const atual = rows.get(productId);
      rows.set(productId, {
        productId,
        status: 'pending',
        rowNumber: atual?.rowNumber ?? null,
        attempts: atual?.attempts ?? 0,
        lastError: atual?.lastError ?? null,
      });
    },
    async findByProductId(productId: string) {
      return rows.get(productId) ?? null;
    },
    async markSynced(productId: string, rowNumber: number) {
      const r = rows.get(productId)!;
      rows.set(productId, { ...r, status: 'synced', rowNumber, attempts: r.attempts + 1, lastError: null });
    },
    async markFailed(productId: string, lastError: string) {
      const r = rows.get(productId)!;
      rows.set(productId, { ...r, status: 'failed', attempts: r.attempts + 1, lastError });
    },
    async setRowNumber(productId: string, rowNumber: number) {
      const r = rows.get(productId)!;
      rows.set(productId, { ...r, rowNumber });
    },
  };
  return { rows, repo: repo as unknown as ProductSheetRepository };
}

function fakeProductRepo(...produtos: Product[]) {
  const byId = new Map(produtos.map((p) => [p.id, p]));
  return {
    async findById(id: string) {
      return byId.get(id) ?? null;
    },
  } as unknown as ProductRepository;
}

/** Planilha com cabeçalhos válidos e dois produtos (linhas 11 e 12). */
function planilha() {
  return new FakeSheetsGateway()
    .comCabecalhos()
    .comProduto(11, 'TESTE', 'aaaa1111')
    .comProduto(12, 'FARINHA DE TRIGO ALVEAR', 'bbbb2222');
}

const enabledOriginal = env.GOOGLE_SHEETS_ENABLED;

beforeEach(() => {
  env.GOOGLE_SHEETS_ENABLED = true;
});

afterEach(() => {
  env.GOOGLE_SHEETS_ENABLED = enabledOriginal;
});

describe('ProductSheetService — criação de linha nova', () => {
  it('grava na primeira linha vazia, põe o UUID em CP e persiste o row_number', async () => {
    const sheets = planilha();
    const { rows, repo: syncRepo } = fakeSyncRepo();
    const p = produto();
    const service = new ProductSheetService(fakeProductRepo(p), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.outcome).toBe('synced');
    expect(res.rowNumber).toBe(13); // 11 e 12 ocupadas
    expect(sheets.get('CP13')).toBe(ID);
    expect(sheets.get('E13')).toBe('PAO FRANCES');
    expect(sheets.get('AC13')).toBe('00042');
    expect(rows.get(ID)).toMatchObject({ status: 'synced', rowNumber: 13, attempts: 1, lastError: null });
  });

  it('mapeia as colunas do produto na linha nova', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await service.syncProduct(ID);

    expect(sheets.get('C13')).toBe('ATIVO');
    expect(sheets.get('D13')).toBe(env.GOOGLE_SHEETS_DEFAULT_LOJAS);
    expect(sheets.get('F13')).toBe('50,000');
    expect(sheets.get('G13')).toBe('G');
    expect(sheets.get('J13')).toBe('07891234000019'); // zero à esquerda preservado
    expect(sheets.get('N13')).toBe('1');
    expect(sheets.get('R13')).toBe('MER PADARIA');
    expect(sheets.get('AJ13')).toBe('0.5');
    expect(sheets.get('AL13')).toBe('0.7'); // fração, como a coluna 0% espera
    expect(sheets.get('AN13')).toBe('SIM');
    expect(sheets.get('CN13')).toBe('NÃO');
  });

  it('código de barras com zero à esquerda é gravado como TEXTO (RAW)', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await service.syncProduct(ID);

    const escritaJ = sheets.writes.find((w) => w.range === 'J13');
    expect(escritaJ).toMatchObject({ option: 'RAW', value: '07891234000019' });
  });

  it('copia formatação e fórmulas da linha anterior, sem copiar valores nem o ID do modelo', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await service.syncProduct(ID);

    const tipos = sheets.structuralRequests.map(
      (r) => (r as { copyPaste?: { pasteType?: string } }).copyPaste?.pasteType,
    );
    expect(tipos).toContain('PASTE_FORMAT'); // formatação + validações
    expect(tipos).toContain('PASTE_FORMULA'); // só as colunas com fórmula

    // as fórmulas chegaram na linha nova, com a referência ajustada
    expect(sheets.get('H13')).toBe('=E13&" "&F13&" "&G13');
    expect(sheets.get('AO13')).toBe('=ROUND(AJ13*AL13,2)');

    // e o valor manual do modelo NÃO foi copiado
    expect(sheets.get('E13')).toBe('PAO FRANCES');
    expect(sheets.get('E13')).not.toBe('FARINHA DE TRIGO ALVEAR');
  });

  it('nunca escreve nas colunas calculadas', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await service.syncProduct(ID);

    const calculadas = ['H', 'P', 'U', 'AD', 'AF', 'AH', 'AK', 'AO', 'AP', 'AR', 'AT', 'AV', 'AX', 'AY', 'BI', 'BJ', 'BR'];
    const colunasEscritas = sheets.writes.map((w) => /^([A-Z]+)/.exec(w.range)![1]!);
    for (const col of calculadas) {
      expect(colunasEscritas, `coluna calculada ${col} não pode ser escrita`).not.toContain(col);
    }
  });

  it('usa a linha 11 quando a aba não tem nenhum produto ainda', async () => {
    const sheets = new FakeSheetsGateway().comCabecalhos();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.rowNumber).toBe(11);
    expect(sheets.get('CP11')).toBe(ID);
  });
});

describe('ProductSheetService — idempotência', () => {
  it('reenvio do mesmo produto NÃO cria linha duplicada', async () => {
    const sheets = planilha();
    const { rows, repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const primeira = await service.syncProduct(ID);
    const estruturaisDepoisDaPrimeira = sheets.structuralRequests.length;
    const segunda = await service.syncProduct(ID);

    expect(primeira.rowNumber).toBe(13);
    expect(segunda.rowNumber).toBe(13); // mesma linha
    expect(sheets.get('E14')).toBe(''); // nenhuma linha nova consumida
    expect(sheets.get('CP14')).toBe('');
    // no reenvio não há preparação de linha nova (nada de copyPaste)
    expect(sheets.structuralRequests.length).toBe(estruturaisDepoisDaPrimeira);
    expect(rows.get(ID)).toMatchObject({ status: 'synced', rowNumber: 13, attempts: 2 });
  });

  it('atualiza a linha encontrada por CP, mesmo se o row_number salvo estiver errado', async () => {
    // o produto está na linha 12 da planilha (alguém moveu a linha), mas o banco
    // registrou a linha 99
    const sheets = new FakeSheetsGateway()
      .comCabecalhos()
      .comProduto(11, 'TESTE', 'aaaa1111')
      .comProduto(12, 'NOME ANTIGO', ID);
    const { rows, repo: syncRepo } = fakeSyncRepo();
    await syncRepo.ensurePending({ productId: ID, spreadsheetId: 'x', sheetName: 'y' });
    await syncRepo.setRowNumber(ID, 99);

    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);
    const res = await service.syncProduct(ID);

    expect(res.rowNumber).toBe(12); // achou pelo CP, não pelo row_number
    expect(sheets.get('E12')).toBe('PAO FRANCES'); // linha atualizada
    expect(sheets.get('E13')).toBe(''); // não criou linha nova
    expect(rows.get(ID)).toMatchObject({ status: 'synced', rowNumber: 12 });
  });

  it('dois produtos diferentes ocupam linhas diferentes', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const p1 = produto();
    const p2 = produto({ id: OUTRO_ID, nome: 'BOLO DE CENOURA' });
    const service = new ProductSheetService(fakeProductRepo(p1, p2), syncRepo, sheets);

    const r1 = await service.syncProduct(ID);
    const r2 = await service.syncProduct(OUTRO_ID);

    expect(r1.rowNumber).toBe(13);
    expect(r2.rowNumber).toBe(14);
    expect(sheets.get('CP13')).toBe(ID);
    expect(sheets.get('CP14')).toBe(OUTRO_ID);
  });

  it('criações concorrentes não disputam a mesma linha vazia', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const p1 = produto();
    const p2 = produto({ id: OUTRO_ID, nome: 'BOLO DE CENOURA' });
    const service = new ProductSheetService(fakeProductRepo(p1, p2), syncRepo, sheets);

    const [r1, r2] = await Promise.all([service.syncProduct(ID), service.syncProduct(OUTRO_ID)]);

    expect(new Set([r1.rowNumber, r2.rowNumber]).size).toBe(2);
    expect([r1.outcome, r2.outcome]).toEqual(['synced', 'synced']);
  });
});

describe('ProductSheetService — falha do Google', () => {
  it('falha deixa status failed, conta a tentativa e sanitiza a mensagem', async () => {
    const sheets = planilha();
    sheets.falharEscrita = new Error(
      'Request failed: private_key -----BEGIN PRIVATE KEY-----MIIEvQIBADANBg-----END PRIVATE KEY----- inválida',
    );
    const { rows, repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.outcome).toBe('failed');
    expect(res.message).toContain('Sincronização com a planilha pendente');
    const row = rows.get(ID)!;
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBeTruthy();
    expect(row.lastError).not.toContain('BEGIN PRIVATE KEY');
    expect(row.lastError).not.toContain('MIIEvQIBADANBg');
  });

  it('o produto continua salvo: a falha não lança para quem chamou', async () => {
    const sheets = planilha();
    sheets.falharTudo = new Error('getaddrinfo ENOTFOUND sheets.googleapis.com');
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await expect(service.syncProduct(ID)).resolves.toMatchObject({ outcome: 'failed' });
  });

  it('nova tentativa depois da falha muda para synced, na mesma linha', async () => {
    const sheets = planilha();
    sheets.falharEscrita = new Error('503 Service Unavailable');
    const { rows, repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const falhou = await service.syncProduct(ID);
    expect(falhou.outcome).toBe('failed');
    const linhaReservada = rows.get(ID)!.rowNumber;
    expect(linhaReservada).toBe(13); // reservada antes da escrita

    sheets.falharEscrita = null;
    const ok = await service.syncProduct(ID);

    expect(ok.outcome).toBe('synced');
    expect(ok.rowNumber).toBe(13); // não pulou para a 14
    expect(sheets.get('CP13')).toBe(ID);
    expect(sheets.get('E14')).toBe('');
    expect(rows.get(ID)).toMatchObject({ status: 'synced', rowNumber: 13, attempts: 2, lastError: null });
  });
});

describe('ProductSheetService — validação de cabeçalhos', () => {
  it('cabeçalho divergente aborta ANTES de escrever qualquer célula', async () => {
    const sheets = planilha().set('AC5', 'OUTRA COISA');
    const { rows, repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.outcome).toBe('failed');
    expect(rows.get(ID)!.lastError).toContain('Cabeçalho inesperado');
    expect(sheets.writes).toHaveLength(0);
    expect(sheets.structuralRequests).toHaveLength(0);
  });

  it('cabeçalho ausente (planilha reestruturada) também aborta', async () => {
    const sheets = planilha();
    sheets.cells.delete('CP5');
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.outcome).toBe('failed');
    expect(sheets.writes).toHaveLength(0);
  });

  it('aceita variação de acento/caixa/ponto no cabeçalho', async () => {
    const sheets = planilha().set('AC5', 'codigo int').set('E5', ' Nome ');
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await expect(service.syncProduct(ID)).resolves.toMatchObject({ outcome: 'synced' });
  });

  it('aba inexistente falha sem escrever', async () => {
    const sheets = new FakeSheetsGateway({ title: '(OUTRA) ABA' }).comCabecalhos();
    const { rows, repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.outcome).toBe('failed');
    expect(rows.get(ID)!.lastError).toContain('não encontrada');
    expect(sheets.writes).toHaveLength(0);
  });
});

describe('ProductSheetService — integração desligada / fora de escopo', () => {
  it('GOOGLE_SHEETS_ENABLED=false não toca no Google', async () => {
    env.GOOGLE_SHEETS_ENABLED = false;
    const sheets = planilha();
    const { rows, repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.outcome).toBe('disabled');
    expect(sheets.chamadas).toMatchObject({ getSheets: 0, batchGet: 0, batchUpdateValues: 0, batchUpdate: 0 });
    expect(rows.size).toBe(0);
  });

  it('produto de loja (TNP/LI/HORA) é ignorado nesta etapa', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto({ loja: 'TNP' })), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.outcome).toBe('skipped');
    expect(sheets.writes).toHaveLength(0);
  });

  it('produto inexistente devolve 404 (rota de reprocessamento)', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, sheets);

    await expect(service.syncProduct(ID)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});

describe('ProductSheetService — health (somente leitura)', () => {
  it('confirma autenticação, acesso, aba e cabeçalhos sem escrever nada', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, sheets);

    const health = await service.health();

    expect(health).toMatchObject({
      enabled: true,
      auth: true,
      spreadsheetAcessivel: true,
      abaEncontrada: true,
      sheetId: 42,
      cabecalhosOk: true,
      ok: true,
    });
    expect(health.cabecalhos.map((c) => c.coluna)).toEqual(['E', 'AC', 'CP']);
    expect(sheets.writes).toHaveLength(0);
    expect(sheets.structuralRequests).toHaveLength(0);
  });

  it('aponta o cabeçalho errado sem escrever', async () => {
    const sheets = planilha().set('CP5', 'CODIGO');
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, sheets);

    const health = await service.health();

    expect(health.ok).toBe(false);
    expect(health.cabecalhosOk).toBe(false);
    expect(health.cabecalhos.find((c) => c.coluna === 'CP')).toMatchObject({ encontrado: 'CODIGO', ok: false });
    expect(sheets.writes).toHaveLength(0);
  });

  it('erro de credencial não vaza a chave', async () => {
    const sheets = planilha();
    sheets.falharTudo = new Error('invalid_grant: private_key -----BEGIN PRIVATE KEY-----AAAABBBB-----END PRIVATE KEY-----');
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, sheets);

    const health = await service.health();

    expect(health.ok).toBe(false);
    expect(health.erro).toBeTruthy();
    expect(health.erro).not.toContain('BEGIN PRIVATE KEY');
  });

  it('desligado por env não consulta o Google', async () => {
    env.GOOGLE_SHEETS_ENABLED = false;
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, sheets);

    const health = await service.health();

    expect(health).toMatchObject({ enabled: false, ok: false, erro: 'GOOGLE_SHEETS_ENABLED=false' });
    expect(sheets.chamadas.getSheets).toBe(0);
  });
});
