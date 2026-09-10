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
const TERCEIRO_ID = '0197d7c4-2c9a-7000-8000-000000000003';

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

const envOriginal = {
  enabled: env.GOOGLE_SHEETS_ENABLED,
  spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
};

beforeEach(() => {
  // ambiente "bem configurado" de mentira: o gateway é falso, então estes
  // valores nunca saem daqui. O destino é explícito porque o código NÃO tem
  // mais ID padrão — sem isso a sincronização é recusada.
  env.GOOGLE_SHEETS_ENABLED = true;
  env.GOOGLE_SHEETS_SPREADSHEET_ID = 'id-de-teste-nao-oficial';
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'teste@exemplo.iam.gserviceaccount.com';
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n';
});

afterEach(() => {
  env.GOOGLE_SHEETS_ENABLED = envOriginal.enabled;
  env.GOOGLE_SHEETS_SPREADSHEET_ID = envOriginal.spreadsheetId;
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL = envOriginal.email;
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = envOriginal.key;
});

describe('ProductSheetService — criação de linha nova', () => {
  it('localiza ID e FOTO pelos cabeçalhos na estrutura da planilha oficial', async () => {
    const sheets = new FakeSheetsGateway({ columnCount: 179 })
      .comCabecalhosOficiais()
      .set('E11', 'TESTE')
      .set('FP11', 'aaaa1111')
      .set('E12', 'FARINHA DE TRIGO ALVEAR')
      .set('FP12', 'bbbb2222')
      .comLinhaModelo(12);
    const { repo: syncRepo } = fakeSyncRepo();
    const p = produto({ fotoUrl: 'https://exemplo.test/foto.jpg' });
    const service = new ProductSheetService(fakeProductRepo(p), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res).toMatchObject({ outcome: 'synced', rowNumber: 13 });
    expect(sheets.get('FP13')).toBe(ID);
    expect(sheets.get('FO13')).toBe('https://exemplo.test/foto.jpg');
    expect(sheets.get('CP13')).toBe('');
    expect(sheets.get('CN13')).toBe('');
  });

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

  it('PASTE_FORMAT e PASTE_DATA_VALIDATION são requisições SEPARADAS e ambas obrigatórias', async () => {
    // A doc oficial define PASTE_FORMAT como "paste the format only, EXCLUDING
    // data validation". Uma não substitui a outra: a ausência de qualquer uma
    // deixa a linha nova incompleta.
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await service.syncProduct(ID);

    const tipos = sheets.pasteTypes(13);
    expect(tipos, 'faltou PASTE_FORMAT (formatação)').toContain('PASTE_FORMAT');
    expect(tipos, 'faltou PASTE_DATA_VALIDATION (listas suspensas)').toContain('PASTE_DATA_VALIDATION');
    expect(tipos, 'faltou PASTE_FORMULA (fórmulas)').toContain('PASTE_FORMULA');

    // são requisições distintas, não uma só
    const colagens = sheets.operacoes.filter((o) => o.startsWith('paste:'));
    expect(colagens.filter((o) => o === 'paste:PASTE_FORMAT')).toHaveLength(1);
    expect(colagens.filter((o) => o === 'paste:PASTE_DATA_VALIDATION')).toHaveLength(1);
  });

  it('copia TAMBÉM a validação de dados da linha-modelo', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await service.syncProduct(ID);

    // as listas suspensas (grupo, setor, marca, % desconto) precisam existir na
    // linha nova — sem esta requisição a linha nasce sem validação
    expect(sheets.temValidacaoDeDados(13)).toBe(true);
    expect(sheets.pasteTypes(13).sort()).toEqual(
      ['PASTE_DATA_VALIDATION', 'PASTE_FORMAT', 'PASTE_FORMULA'],
    );
  });

  it('linha = rowCount + 1: expande a grade ANTES de qualquer escrita de valor', async () => {
    // grade termina exatamente na última linha ocupada — a próxima não existe
    const sheets = new FakeSheetsGateway({ rowCount: 12 })
      .comCabecalhos()
      .comProduto(11, 'TESTE', 'aaaa1111')
      .comProduto(12, 'FARINHA', 'bbbb2222');
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.outcome).toBe('synced');
    expect(res.rowNumber).toBe(13); // = rowCount + 1

    // a expansão tem de ser a PRIMEIRA operação, antes de todo write
    const primeiraEscrita = sheets.operacoes.findIndex((o) => o.startsWith('write:'));
    const expansao = sheets.operacoes.indexOf('appendDimension:+1');
    expect(expansao).toBeGreaterThanOrEqual(0);
    expect(primeiraEscrita).toBeGreaterThan(expansao);

    // e a ordem completa do contrato: expandir -> reservar CP -> copiar modelo
    const reservaCP = sheets.operacoes.indexOf('write:CP13');
    const formato = sheets.operacoes.indexOf('paste:PASTE_FORMAT');
    expect(expansao).toBeLessThan(reservaCP);
    expect(reservaCP).toBeLessThan(formato);
  });

  it('sem expansão, escrever fora da grade seria erro de range (o fake reproduz)', async () => {
    // prova que o teste acima não é vácuo: o fake recusa write além do rowCount
    const sheets = new FakeSheetsGateway({ rowCount: 12 }).comCabecalhos();
    await expect(
      sheets.batchUpdateValues('x', [{ range: `'aba'!CP13`, values: [['v']] }], 'RAW'),
    ).rejects.toThrow(/exceeds grid limits/);
  });

  it('expande a grade na medida EXATA, sem linha sobrando', async () => {
    // grade termina na linha 12; a linha nova é a 13 -> falta exatamente 1
    const sheets = new FakeSheetsGateway({ rowCount: 12 })
      .comCabecalhos()
      .comProduto(11, 'TESTE', 'aaaa1111')
      .comProduto(12, 'FARINHA', 'bbbb2222');
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.rowNumber).toBe(13);
    expect(sheets.linhasAcrescentadas()).toBe(1);
  });

  it('não expande a grade quando a linha já cabe', async () => {
    const sheets = planilha(); // rowCount padrão 9930
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await service.syncProduct(ID);

    expect(sheets.linhasAcrescentadas()).toBe(0);
  });

  it('copia estrutura da linha anterior e fórmulas da linha-modelo validada', async () => {
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

  it('não perde fórmulas quando a linha imediatamente anterior está incompleta', async () => {
    const sheets = planilha()
      // linha manual incompleta, igual ao caso encontrado na homologação
      .set('E13', 'PRODUTO MANUAL')
      .set('CP13', 'cccc3333')
      .set('H13', '=E13&" "&F13&" "&G13');
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.rowNumber).toBe(14);
    expect(sheets.get('AO14')).toBe('=ROUND(AJ14*AL14,2)');
    expect(sheets.get('AY14')).toBe('=(AZ14*AO14)+AO14');
    expect(sheets.get('AP14')).toContain('$BB$14:$BH$14');
  });

  it('nunca escreve nas colunas calculadas; P é entrada gerada pelo backend', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await service.syncProduct(ID);

    const calculadas = ['H', 'U', 'AD', 'AF', 'AH', 'AK', 'AO', 'AR', 'AT', 'AV', 'AX', 'AY', 'BI', 'BJ', 'BR'];
    const colunasEscritas = sheets.writes.map((w) => /^([A-Z]+)/.exec(w.range)![1]!);
    for (const col of calculadas) {
      expect(colunasEscritas, `coluna calculada ${col} não pode ser escrita`).not.toContain(col);
    }
    // formato novo (09/09/2026), montado pela regra unica do shared
    expect(sheets.get('P13')).toBe('PAO FRANCES 50 G - UNIDADE DE PAO FRANCES 50 G 1UN');

    // AP é a única exceção: a fórmula histórica da planilha precisa ter a
    // faixa absoluta dos dias corrigida para a própria linha do produto.
    const escritaAp = sheets.writes.find((w) => w.range === 'AP13');
    expect(escritaAp).toMatchObject({ option: 'USER_ENTERED' });
    expect(String(escritaAp?.value)).toContain('$BB$13:$BH$13');
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

  it('reenvio repara fórmulas ausentes na linha reservada sem duplicá-la', async () => {
    const sheets = planilha()
      .set('E13', 'CADASTRO INTERROMPIDO')
      .set('CP13', ID)
      .set('H13', '=E13&" "&F13&" "&G13');
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.rowNumber).toBe(13);
    expect(sheets.get('CP14')).toBe('');
    expect(sheets.get('AO13')).toBe('=ROUND(AJ13*AL13,2)');
    expect(sheets.get('AP13')).toContain('$BB$13:$BH$13');
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

  it('falha PARCIAL não deixa a linha órfã: o UUID já está em CP e o retry a reencontra', async () => {
    const sheets = planilha();
    const { rows, repo: syncRepo } = fakeSyncRepo();
    // deixa a reserva de CP passar e derruba a partir da preparação da linha
    let chamadas = 0;
    const batchUpdateOriginal = sheets.batchUpdate.bind(sheets);
    sheets.batchUpdate = async (id: string, reqs: unknown[]) => {
      chamadas++;
      throw new Error('500 Internal Error na preparação da linha');
      return batchUpdateOriginal(id, reqs);
    };

    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);
    const falhou = await service.syncProduct(ID);

    expect(falhou.outcome).toBe('failed');
    expect(chamadas).toBe(1);
    // a reserva sobreviveu: a linha 13 é reconhecidamente deste produto
    expect(sheets.get('CP13')).toBe(ID);
    expect(sheets.get('E13')).toBe(''); // e nada mais foi escrito
    expect(rows.get(ID)).toMatchObject({ status: 'failed', rowNumber: 13 });
  });

  it('linha reservada NÃO é tomada por outro produto', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    // primeiro produto reserva a 13 e falha na preparação
    sheets.batchUpdate = async () => { throw new Error('503'); };
    const p1 = produto();
    const p2 = produto({ id: OUTRO_ID, nome: 'BOLO DE CENOURA' });
    const service = new ProductSheetService(fakeProductRepo(p1, p2), syncRepo, sheets);

    expect((await service.syncProduct(ID)).outcome).toBe('failed');
    expect(sheets.get('CP13')).toBe(ID);

    // o segundo produto precisa ir para a 14, não sobrescrever a 13
    sheets.batchUpdate = async () => {};
    const r2 = await service.syncProduct(OUTRO_ID);

    expect(r2.rowNumber).toBe(14);
    expect(sheets.get('CP13')).toBe(ID); // intacta
    expect(sheets.get('CP14')).toBe(OUTRO_ID);
    expect(sheets.get('E14')).toBe('BOLO DE CENOURA');
  });

  it('nova tentativa depois da falha muda para synced, na mesma linha', async () => {
    const sheets = planilha();
    sheets.falharEscrita = new Error('503 Service Unavailable');
    const { rows, repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const falhou = await service.syncProduct(ID);
    expect(falhou.outcome).toBe('failed');
    // a falha derrubou até a reserva: nada foi escrito e NÃO há linha fantasma
    // registrada no banco — a planilha é quem manda sobre o que foi reservado
    expect(rows.get(ID)).toMatchObject({ status: 'failed', rowNumber: null });
    expect(sheets.get('CP13')).toBe('');

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

  it('LIGADA sem spreadsheet ID => recusa e NÃO toca no Google', async () => {
    env.GOOGLE_SHEETS_SPREADSHEET_ID = ''; // como se a variável não existisse
    const sheets = planilha();
    const { rows, repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.syncProduct(ID);

    expect(res.outcome).toBe('misconfigured');
    expect(res.outcome).not.toBe('disabled'); // erro de config não se disfarça de escolha
    expect(res.message).toContain('GOOGLE_SHEETS_SPREADSHEET_ID');
    // nenhuma chamada ao Google, de nenhum tipo
    expect(sheets.chamadas).toMatchObject({ getSheets: 0, batchGet: 0, batchUpdateValues: 0, batchUpdate: 0 });
    expect(sheets.writes).toHaveLength(0);
    expect(rows.size).toBe(0);
  });

  it('LIGADA sem nome de aba => também recusa', async () => {
    const tabOriginal = env.GOOGLE_SHEETS_BASE_TAB;
    env.GOOGLE_SHEETS_BASE_TAB = '';
    try {
      const sheets = planilha();
      const { repo: syncRepo } = fakeSyncRepo();
      const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

      const res = await service.syncProduct(ID);

      expect(res.outcome).toBe('misconfigured');
      expect(res.message).toContain('GOOGLE_SHEETS_BASE_TAB');
      expect(sheets.writes).toHaveLength(0);
    } finally {
      env.GOOGLE_SHEETS_BASE_TAB = tabOriginal;
    }
  });

  it('health aponta a variável que falta, sem consultar o Google', async () => {
    env.GOOGLE_SHEETS_SPREADSHEET_ID = '';
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, sheets);

    const health = await service.health();

    expect(health.ok).toBe(false);
    expect(health.configOk).toBe(false);
    expect(health.configFaltando).toContain('GOOGLE_SHEETS_SPREADSHEET_ID');
    expect(health.erro).toContain('Configuração incompleta');
    expect(sheets.chamadas.getSheets).toBe(0);
    // reporta NOMES de variáveis, nunca valores
    expect(health.configFaltando.every((v) => /^[A-Z_]+$/.test(v))).toBe(true);
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
  it('reconhece os cabeçalhos móveis da planilha oficial', async () => {
    const sheets = new FakeSheetsGateway({ columnCount: 179 }).comCabecalhosOficiais();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, sheets);

    const health = await service.health();

    expect(health.ok).toBe(true);
    expect(health.cabecalhos).toEqual(expect.arrayContaining([
      expect.objectContaining({ coluna: 'FP', esperado: 'ID', ok: true }),
      expect.objectContaining({ coluna: 'FO', esperado: 'FOTO', ok: true }),
    ]));
  });

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
    expect(health.cabecalhos.map((c) => c.coluna)).toEqual(['E', 'AC', 'CP', 'CO']);
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
    expect(health.cabecalhos.find((c) => c.esperado === 'ID')).toMatchObject({
      coluna: '?', encontrado: '', ok: false,
    });
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

describe('ProductSheetService — importação em lote no leiaute novo', () => {
  function planilhaNovaComBase() {
    return new FakeSheetsGateway({ columnCount: 26 })
      // As seções da linha 3 são o contrato que distingue o leiaute novo.
      .set('D3', 'CADASTRO GERAL')
      .set('L3', 'TNP - CADASTRO')
      .set('O3', 'LI - CADASTRO')
      .set('R3', 'RODAPE')
      .set('A5', 'V')
      .set('D5', 'CADASTRO PRODUTOS ATUALIZADO NOVO')
      .set('F5', 'CODIGO BARRAS')
      .set('G5', 'MARCAS')
      .set('L5', 'CUSTO')
      .set('M5', 'ESTOQUE MIN')
      .set('O5', 'CUSTO')
      .set('P5', 'ESTOQUE MIN')
      .set('Z5', 'ID')
      .set('D11', 'PAO FRANCES')
      .set('Z11', ID);
  }

  it('localiza uma vez a linha da BASE e escreve cada loja somente na sua faixa', async () => {
    const sheets = planilhaNovaComBase();
    const { rows, repo: syncRepo } = fakeSyncRepo();
    const tnp = produto({ id: OUTRO_ID, loja: 'TNP', baseProductId: ID, custo: 1.25, estoqueMin: 7 });
    const li = produto({ id: TERCEIRO_ID, loja: 'LI', baseProductId: ID, custo: 2.5, estoqueMin: 9 });
    const service = new ProductSheetService(fakeProductRepo(tnp, li), syncRepo, sheets);

    const res = await service.syncStoreProducts([tnp, li]);

    expect(res).toEqual([
      expect.objectContaining({ outcome: 'synced', rowNumber: 11 }),
      expect.objectContaining({ outcome: 'synced', rowNumber: 11 }),
    ]);
    expect(sheets.get('L11')).toBe('1.25'); // TNP - CADASTRO
    expect(sheets.get('M11')).toBe('7');
    expect(sheets.get('O11')).toBe('2.5'); // LI - CADASTRO
    expect(sheets.get('P11')).toBe('9');
    expect(rows.get(OUTRO_ID)).toMatchObject({ status: 'synced', rowNumber: 11 });
    expect(rows.get(TERCEIRO_ID)).toMatchObject({ status: 'synced', rowNumber: 11 });
    // Layout (linhas 5 e 3), coluna ID e as fórmulas das linhas alvo: quatro
    // leituras para o lote inteiro; nenhuma se repete por produto.
    expect(sheets.chamadas.batchGet).toBe(4);
  });

  it('não grava valor por cima de coluna que a planilha calcula', async () => {
    // MARCAS calculada nesta linha; CUSTO segue sendo coluna de entrada.
    const sheets = planilhaNovaComBase().set('G11', '=UPPER(D11)');
    const { repo: syncRepo } = fakeSyncRepo();
    const tnp = produto({
      id: OUTRO_ID, loja: 'TNP', baseProductId: ID, marca: 'KAMI', custo: 1.25,
    });
    const service = new ProductSheetService(fakeProductRepo(tnp), syncRepo, sheets);

    await service.syncStoreProducts([tnp]);

    expect(sheets.get('G11')).toBe('=UPPER(D11)');
    expect(sheets.get('L11')).toBe('1.25');
  });

  it('no leiaute antigo devolve skipped para permitir o fallback dedicado', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const li = produto({ id: OUTRO_ID, loja: 'LI', baseProductId: ID });
    const service = new ProductSheetService(fakeProductRepo(li), syncRepo, sheets);

    await expect(service.syncStoreProducts([li])).resolves.toEqual([
      expect.objectContaining({ outcome: 'skipped' }),
    ]);
    expect(sheets.writes).toHaveLength(0);
  });
});

describe('ProductSheetService — exclusão espelhada na planilha', () => {
  it('limpa as colunas de entrada da linha do produto', async () => {
    const sheets = new FakeSheetsGateway()
      .comCabecalhos()
      .comProduto(11, 'TESTE', 'aaaa1111')
      .comProduto(12, 'PAO FRANCES', ID);
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.removeProduct(ID);

    expect(res).toMatchObject({ outcome: 'removed', rowNumber: 12 });
    expect(sheets.get('E12')).toBe('');
    expect(sheets.get('CP12')).toBe('');
  });

  it('NÃO destrói as fórmulas da linha — a linha 12 é a linha-modelo do sistema', async () => {
    const sheets = new FakeSheetsGateway()
      .comCabecalhos()
      .comProduto(11, 'TESTE', 'aaaa1111')
      .comProduto(12, 'PAO FRANCES', ID);
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    await service.removeProduct(ID);

    // se estas fórmulas sumissem, TODA sincronização futura passaria a falhar
    // com "Linha-modelo 12 incompleta"
    expect(sheets.get('H12')).toMatch(/^=/);
    expect(sheets.get('AP12')).toMatch(/^=/);
    expect(sheets.get('AO12')).toMatch(/^=/);
  });

  it('a linha liberada é reaproveitada pelo próximo cadastro', async () => {
    const sheets = new FakeSheetsGateway()
      .comCabecalhos()
      .comProduto(11, 'TESTE', 'aaaa1111')
      .comProduto(12, 'PAO FRANCES', ID)
      .comProduto(13, 'ACUCAR', 'cccc3333');
    const { repo: syncRepo } = fakeSyncRepo();
    const outro = produto({ id: OUTRO_ID, nome: 'CAFE TORRADO' });
    const service = new ProductSheetService(fakeProductRepo(produto(), outro), syncRepo, sheets);

    await service.removeProduct(ID);
    const res = await service.syncProduct(OUTRO_ID);

    expect(res).toMatchObject({ outcome: 'synced', rowNumber: 12 });
    expect(sheets.get('E12')).toBe('CAFE TORRADO');
    expect(sheets.get('CP12')).toBe(OUTRO_ID);
    expect(sheets.get('E13')).toBe('ACUCAR'); // nada se deslocou
  });

  it('produto que não está na planilha não é erro (idempotente)', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.removeProduct(ID);

    expect(res.outcome).toBe('absent');
    expect(sheets.writes).toHaveLength(0);
  });

  it('falha no Google devolve failed e não vaza credencial', async () => {
    const sheets = new FakeSheetsGateway()
      .comCabecalhos()
      .comProduto(11, 'PAO FRANCES', ID);
    sheets.falharEscrita = new Error('quota exceeded -----BEGIN PRIVATE KEY-----AAAA-----END PRIVATE KEY-----');
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.removeProduct(ID);

    expect(res.outcome).toBe('failed');
    expect(res.error).not.toContain('BEGIN PRIVATE KEY');
    expect(sheets.get('E11')).toBe('PAO FRANCES'); // nada foi apagado
  });

  it('integração desligada não chama o Google', async () => {
    env.GOOGLE_SHEETS_ENABLED = false;
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.removeProduct(ID);

    expect(res.outcome).toBe('disabled');
    expect(sheets.chamadas.getSheets).toBe(0);
  });

  it('ligada sem destino configurado recusa antes de tocar no Google', async () => {
    env.GOOGLE_SHEETS_SPREADSHEET_ID = '';
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(produto()), syncRepo, sheets);

    const res = await service.removeProduct(ID);

    expect(res.outcome).toBe('misconfigured');
    expect(sheets.chamadas.getSheets).toBe(0);
  });

  it('produto de loja não é espelhado nesta etapa', async () => {
    const sheets = planilha();
    const { repo: syncRepo } = fakeSyncRepo();
    const p = produto({ loja: 'TNP' });
    const service = new ProductSheetService(fakeProductRepo(p), syncRepo, sheets);

    const res = await service.removeProduct(ID);

    expect(res.outcome).toBe('skipped');
    expect(sheets.writes).toHaveLength(0);
  });
});

describe('ProductSheetService — diagnóstico das abas de cadastro', () => {
  const TNP = '(TNP) CADASTRO PRODUTOS';

  /** Planilha com a BASE pronta e a TNP no layout REAL (sem coluna ID). */
  function comAbaTnpReal() {
    return planilha()
      .setNaAba(TNP, 'C5', 'A/I')
      .setNaAba(TNP, 'D5', 'CADASTRO PRODUTOS ATUALIZADO NOVO')
      .setNaAba(TNP, 'E5', 'CADASTRO PRODUTOS HISTORICO ANTIGO')
      .setNaAba(TNP, 'F5', 'CODIGO BARRAS')
      .setNaAba(TNP, 'AC5', 'ESTOQUE MAX')
      .setNaAba(TNP, 'CK5', 'FOTO');
  }

  it('a BASE aparece pronta para espelhamento', async () => {
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, comAbaTnpReal());

    const health = await service.health();
    const base = health.abas.find((a) => a.loja === 'BASE')!;

    expect(base).toMatchObject({ encontrada: true, pronta: true, colunaId: 'CP', colunaFoto: 'CO' });
    expect(base.faltando).toEqual([]);
  });

  it('a aba da TNP aparece NÃO pronta, dizendo exatamente o que falta', async () => {
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, comAbaTnpReal());

    const health = await service.health();
    const tnp = health.abas.find((a) => a.loja === 'TNP')!;

    expect(tnp.encontrada).toBe(true);
    expect(tnp.pronta).toBe(false);
    expect(tnp.colunaId).toBeNull();       // é o que impede achar a linha do produto
    expect(tnp.colunaFoto).toBe('CK');     // essa ela tem, em outra coluna
    expect(tnp.faltando).toEqual(['coluna ID', 'NOME na coluna E', 'CODIGO INT. na coluna AC']);
  });

  it('aba que não existe na planilha é reportada como não encontrada', async () => {
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, comAbaTnpReal());

    const health = await service.health();
    const li = health.abas.find((a) => a.loja === 'LI')!;

    expect(li).toMatchObject({ encontrada: false, pronta: false });
    expect(li.faltando).toEqual(['aba não encontrada']);
  });

  it('o diagnóstico não escreve nada na planilha', async () => {
    const sheets = comAbaTnpReal();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, sheets);

    await service.health();

    expect(sheets.writes).toHaveLength(0);
    expect(sheets.chamadas.batchUpdate).toBe(0);
  });

  it('desligado não consulta o Google nem monta diagnóstico', async () => {
    env.GOOGLE_SHEETS_ENABLED = false;
    const sheets = comAbaTnpReal();
    const { repo: syncRepo } = fakeSyncRepo();
    const service = new ProductSheetService(fakeProductRepo(), syncRepo, sheets);

    const health = await service.health();

    expect(health.abas).toEqual([]);
    expect(sheets.chamadas.getSheets).toBe(0);
  });
});

describe('ProductSheetService — exclusão no leiaute NOVO', () => {
  /**
   * A linha é compartilhada: BASE e lojas moram nela lado a lado. Apagar por
   * `INPUT_COLUMNS`, que são as letras do leiaute ANTIGO, varria colunas
   * alheias — o antigo `AJ` era CUSTO e na planilha nova é `V. VENDA`, que é
   * fórmula.
   */
  function planilhaNovaParaExcluir() {
    return new FakeSheetsGateway({ columnCount: 26 })
      .set('D3', 'CADASTRO GERAL')
      .set('L3', 'TNP - CADASTRO')
      .set('O3', 'LI - CADASTRO')
      .set('R3', 'RODAPE')
      .set('A5', 'V')
      .set('D5', 'CADASTRO PRODUTOS ATUALIZADO NOVO')
      .set('F5', 'CODIGO BARRAS')
      .set('G5', 'MARCAS')
      .set('L5', 'CUSTO')
      .set('M5', 'ESTOQUE MIN')
      .set('O5', 'CUSTO')
      .set('P5', 'ESTOQUE MIN')
      .set('Z5', 'ID')
      .set('D11', 'PAO FRANCES')
      .set('G11', 'PANIFICADORA')
      .set('L11', '1.25')
      .set('O11', '2.5')
      .set('Z11', ID);
  }

  /** Colunas que a exclusão escreveu (sempre com valor vazio). */
  const limpas = (sheets: FakeSheetsGateway) => sheets.writes
    .filter((w) => w.value === '')
    .map((w) => /^([A-Z]+)\d+$/.exec(w.range)?.[1])
    .filter((c): c is string => !!c)
    .sort();

  it('produto da BASE libera as colunas gerais e o ID', async () => {
    const sheets = planilhaNovaParaExcluir();
    const { repo: syncRepo } = fakeSyncRepo();
    const base = produto({ id: ID, loja: 'BASE' });
    const service = new ProductSheetService(fakeProductRepo(base), syncRepo, sheets);

    const r = await service.removeProduct(ID);

    expect(r.outcome).toBe('removed');
    const cols = limpas(sheets);
    expect(cols).toContain('D'); // nome
    expect(cols).toContain('Z'); // ID: é ele que devolve a linha ao pool
    // e NÃO varre as faixas de loja de quem divide a linha
    expect(cols).not.toContain('L');
    expect(cols).not.toContain('O');
  });

  it('cópia de loja apaga SÓ a faixa dela — a BASE continua inteira', async () => {
    const sheets = planilhaNovaParaExcluir();
    const { repo: syncRepo } = fakeSyncRepo();
    const li = produto({ id: OUTRO_ID, loja: 'LI', baseProductId: ID });
    const service = new ProductSheetService(fakeProductRepo(li), syncRepo, sheets);

    const r = await service.removeProduct(OUTRO_ID);

    expect(r.outcome).toBe('removed');
    const cols = limpas(sheets);
    expect(cols).toContain('O'); // CUSTO da faixa LI
    expect(cols).toContain('P'); // ESTOQUE MIN da faixa LI
    // o que é da BASE e da outra loja fica de pé
    expect(cols).not.toContain('D'); // nome do produto
    expect(cols).not.toContain('Z'); // o ID continua sendo da BASE
    expect(cols).not.toContain('L'); // faixa da TNP
  });

  it('não apaga coluna que a planilha calcula', async () => {
    const sheets = planilhaNovaParaExcluir().set('G11', '=UPPER(D11)');
    const { repo: syncRepo } = fakeSyncRepo();
    const base = produto({ id: ID, loja: 'BASE' });
    const service = new ProductSheetService(fakeProductRepo(base), syncRepo, sheets);

    await service.removeProduct(ID);

    expect(limpas(sheets)).not.toContain('G');
    expect(sheets.get('G11')).toBe('=UPPER(D11)');
  });
});
