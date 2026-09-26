/**
 * Robô local: Google Sheets -> TXT posicional do Criare/SIA.
 *
 * O processo é deliberadamente fail-closed: uma linha incompleta nunca produz
 * arquivo. O estado local guarda o último registro exportado por produto/loja,
 * de modo que uma alteração posterior gere outro TXT sem repetir a mesma versão.
 *
 * Uso (a partir de stack/api):
 *   npx tsx scripts/creare-planilha-bot.ts --once
 *   npx tsx scripts/creare-planilha-bot.ts --watch
 *   npx tsx scripts/creare-planilha-bot.ts --once --produto "FAROFA TRADICIONAL YOKI" --force
 */
import 'reflect-metadata';
import 'dotenv/config';

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Creare, ProductRules } from '@pralis/shared';
import { env } from '@/config/env';
import {
  GoogleSheetsClient, a1, colToIndex, indexToCol,
} from '@/modules/google-sheets/google-sheets.client';
import { faixasDaAba, normalizarCabecalho, resolverDestino } from '@/modules/google-sheets/sheet-traducao';

type Store = 'TNP' | 'LI';

interface StoreConfig {
  enabled: boolean;
  groupCodes: Record<string, string>;
  categoryCodes: Record<string, string>;
  units: Record<string, string>;
  decimalPlaces: Creare.CreareDecimalPlaces;
  barcodeField: 'short' | 'extended';
  lineEnding: 'CRLF' | 'LF';
  noPromotionDate: string;
  iat: 'A' | 'T';
  weighableUnits: string[];
  stockControlled: 'S' | 'N';
  /**
   * O bloco fiscal INTEIRO sai zerado, para TODO produto, ignorando qualquer
   * outra fonte.
   *
   * Decisão do José em 26/09/2026: *"o espaço fiscal não são alguns completos
   * com zero, é tudo, tudo será completado com zeros"*. A versão anterior
   * zerava só quem não achava valor em lugar nenhum, e o resultado era um
   * arquivo com dois critérios: 1.462 produtos com NCM e ECF reais vindos das
   * tabelas antigas, 5.884 zerados. Ninguém escolheu isso.
   *
   * Com isto ligado o robô nem lê as tabelas fiscais — duas planilhas a menos
   * por rodada. O preenchimento fiscal de verdade é assunto do sistema, pelo
   * backfill, e não deste arquivo.
   *
   * Zero também é valor fiscal: ele tributa. E `ecfTaxCode` e `categoryCode`
   * são chave estrangeira no Criare — chave que não existe derruba o arquivo
   * inteiro. Subir num ambiente de teste antes do de verdade.
   */
  fiscalZerado?: boolean;
}

/** O bloco fiscal zerado, na largura exata de cada campo do layout. */
const FISCAL_ZERADO = {
  ncm: '00000000',
  cest: '0000000',
  ecfTaxCode: '00',
  pisCofinsCst: '00',
  categoryCode: '000000000',
} as const;

interface BotConfig {
  spreadsheetId: string;
  sheetName: string;
  firstDataRow: number;
  pollIntervalSeconds: number;
  outputDir: string;
  /** TXT(s) já aceitos pelo Criare; preservam campos que a planilha não possui. */
  referenceTxtFiles?: string[];
  fiscal: FiscalConfig;
  stores: Partial<Record<Store, StoreConfig>>;
}

interface FiscalOverride {
  ncm?: string;
  cest?: string;
  ecfTaxCode?: string;
  groupCode?: string;
  categoryCode?: string;
  icmsReduction?: string;
  fullTaxRate?: string;
  fcpRate?: string;
  pisRate?: string;
  cofinsRate?: string;
  source: string;
}

interface FiscalConfig {
  officialSheetName: string;
  legacySpreadsheetId: string;
  legacySheetName: string;
  productOverrides: Record<string, FiscalOverride>;
}

interface FiscalProduct {
  ncm: string;
  pisCofinsCst: string;
  icmsReduction: string;
  fullTaxRate: string;
  fcpRate: string;
  pisRate: string;
  cofinsRate: string;
  ecfTaxCode: string;
  categoryCode: string;
  cest: string;
  groupCode: string;
}

interface FiscalContext {
  byBarcode: Map<string, FiscalProduct>;
  officialByBarcode: Map<string, Pick<FiscalProduct, 'ncm' | 'pisCofinsCst'>>;
  groupCst: Map<string, string>;
  inferredGroupCodes: Map<string, string>;
  overrides: Map<string, FiscalOverride>;
}

interface StateEntry {
  lastExportedHash?: string;
  name: string;
  row: number;
  updatedAt: string;
}

interface BotState {
  version: 1;
  initialized: boolean;
  products: Record<string, StateEntry>;
}

interface SheetData {
  sections: string[];
  headers: string[];
  rows: string[][];
}

interface ProductResult {
  key: string;
  name: string;
  row: number;
  store: Store;
  record?: string;
  hash?: string;
  missing: string[];
}

type ReferenceRecord = ReturnType<typeof Creare.parseCreareRecord>;

const args = new Set(process.argv.slice(2));
const valueAfter = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const watch = args.has('--watch');
const force = args.has('--force');
const productFilter = valueAfter('--produto')?.trim().toLocaleUpperCase('pt-BR');
const configPath = path.resolve(
  valueAfter('--config')
    ?? path.join(__dirname, 'creare-planilha.config.json'),
);

const text = (value: unknown): string => String(value ?? '').trim();
const digits = (value: unknown): string => text(value).replace(/\D/g, '');
const normalized = (value: unknown): string => normalizarCabecalho(text(value));
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

function parseLocaleNumber(value: unknown): number | null {
  const raw = text(value).replace(/R\$/gi, '').replace(/\s/g, '');
  if (!raw || raw === '—') return null;
  let canonical = raw;
  if (raw.includes(',') && raw.includes('.')) canonical = raw.replace(/\./g, '').replace(',', '.');
  else if (raw.includes(',')) canonical = raw.replace(',', '.');
  canonical = canonical.replace('%', '');
  const n = Number(canonical);
  return Number.isFinite(n) ? n : null;
}

function parseImplied(value: unknown, decimals: number): number | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) / 10 ** decimals;
  return parseLocaleNumber(raw);
}

function requireMapped(
  map: Record<string, string>,
  source: string,
  label: string,
  missing: string[],
): string {
  if (!source) {
    missing.push(label);
    return '';
  }
  const direct = map[source] ?? map[normalized(source)];
  if (!text(direct)) {
    missing.push(`${label} (sem de-para para "${source}")`);
    return '';
  }
  return text(direct);
}

async function loadConfig(): Promise<BotConfig> {
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as BotConfig;
  raw.spreadsheetId ||= env.GOOGLE_SHEETS_SPREADSHEET_ID;
  raw.sheetName ||= env.GOOGLE_SHEETS_BASE_TAB;
  raw.outputDir = path.resolve(raw.outputDir);
  raw.referenceTxtFiles = (raw.referenceTxtFiles ?? [])
    .map((file) => path.resolve(path.dirname(configPath), file));
  if (!raw.spreadsheetId || !raw.sheetName || !raw.outputDir) {
    throw new Error('Configuração incompleta: spreadsheetId, sheetName e outputDir são obrigatórios.');
  }
  return raw;
}

function impliedNumber(value: string, decimals: number): number {
  const raw = digits(value);
  return raw ? Number(raw) / 10 ** decimals : 0;
}

async function loadReferenceRecords(config: BotConfig): Promise<Map<string, ReferenceRecord>> {
  const records = new Map<string, ReferenceRecord>();
  for (const file of config.referenceTxtFiles ?? []) {
    const contents = await readFile(file, 'utf8');
    for (const line of contents.split(/\r?\n/).filter((item) => item.length > 0)) {
      const record = Creare.parseCreareRecord(line);
      for (const rawBarcode of [record.extendedBarcode, record.barcode]) {
        const key = digits(rawBarcode).replace(/^0+(?=\d)/, '');
        if (key && !/^0+$/.test(key)) records.set(key, record);
      }
    }
  }
  return records;
}

async function loadState(file: string): Promise<BotState> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as BotState;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
    return { version: 1, initialized: false, products: {} };
  }
}

async function atomicWrite(file: string, contents: string | Buffer): Promise<void> {
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, contents);
  await rename(temp, file);
}

async function readSheet(config: BotConfig): Promise<SheetData> {
  const client = new GoogleSheetsClient();
  const meta = (await client.getSheets(config.spreadsheetId)).find((s) => s.title === config.sheetName);
  if (!meta) throw new Error(`Aba "${config.sheetName}" não encontrada.`);
  const lastColumn = indexToCol(meta.columnCount - 1);
  const [sections, headers, rows] = await client.batchGetValues(
    config.spreadsheetId,
    [
      a1(config.sheetName, `A3:${lastColumn}3`),
      a1(config.sheetName, `A5:${lastColumn}5`),
      a1(config.sheetName, `A${config.firstDataRow}:${lastColumn}${meta.rowCount}`),
    ],
    'FORMATTED_VALUE',
  );
  return {
    sections: sections?.[0] ?? [],
    headers: headers?.[0] ?? [],
    rows: rows ?? [],
  };
}

async function loadFiscalContext(config: BotConfig, sheet: SheetData): Promise<FiscalContext> {
  const client = new GoogleSheetsClient();
  const [officialRanges, legacyRanges] = await Promise.all([
    client.batchGetValues(config.spreadsheetId, [
      a1(config.fiscal.officialSheetName, 'A4:E2000'),
      a1(config.fiscal.officialSheetName, 'AB4:AG200'),
    ], 'FORMATTED_VALUE'),
    client.batchGetValues(config.fiscal.legacySpreadsheetId, [
      a1(config.fiscal.legacySheetName, 'M11:AY5000'),
      a1(config.fiscal.legacySheetName, 'BN11:BO5000'),
      a1(config.fiscal.legacySheetName, 'BV11:BW5000'),
    ], 'FORMATTED_VALUE'),
  ]);

  const officialByBarcode = new Map<string, Pick<FiscalProduct, 'ncm' | 'pisCofinsCst'>>();
  for (const [barcode = '', ncm = '', cst = ''] of officialRanges[0] ?? []) {
    const key = digits(barcode).replace(/^0+(?=\d)/, '');
    if (key) officialByBarcode.set(key, { ncm: digits(ncm), pisCofinsCst: digits(cst) });
  }

  const groupCst = new Map<string, string>();
  for (const [group = '', cst = ''] of officialRanges[1] ?? []) {
    if (text(group) && digits(cst)) groupCst.set(normalized(group), digits(cst));
  }

  const [legacyFiscal = [], legacyGroups = [], legacyBarcodes = []] = legacyRanges;
  const byBarcode = new Map<string, FiscalProduct>();
  for (let i = 0; i < Math.max(legacyFiscal.length, legacyGroups.length, legacyBarcodes.length); i += 1) {
    const fiscal = legacyFiscal[i] ?? [];
    const groups = legacyGroups[i] ?? [];
    const barcodes = legacyBarcodes[i] ?? [];
    const product: FiscalProduct = {
      // M:AY; deslocamentos conferidos contra o cabeçalho da linha 6.
      icmsReduction: text(fiscal[16]), fullTaxRate: text(fiscal[17]), fcpRate: text(fiscal[18]),
      pisCofinsCst: text(fiscal[19]), pisRate: text(fiscal[20]), cofinsRate: text(fiscal[21]),
      ecfTaxCode: digits(fiscal[23]), ncm: digits(fiscal[24]), cest: digits(fiscal[30]),
      categoryCode: digits(fiscal[38]), groupCode: digits(groups[0]),
    };
    for (const raw of barcodes) {
      const key = digits(raw).replace(/^0+(?=\d)/, '');
      if (key && !/^0+$/.test(key)) byBarcode.set(key, product);
    }
  }

  // Aprende grupo novo -> código do grupo antigo apenas quando todos os EANs
  // encontrados concordam. Um grupo divergente fica sem mapa e bloqueia o TXT.
  const candidates = new Map<string, Set<string>>();
  for (const row of sheet.rows) {
    const { cell } = buildAccessor(sheet, row);
    const barcode = digits(cell('CODIGO BARRAS')).replace(/^0+(?=\d)/, '');
    const group = cell('GRUPO MERCADORIAS (REVENDA)') || cell('GRUPO MERCADORIAS (TRANSFORMAÇÃO)');
    const legacy = byBarcode.get(barcode);
    if (!group || !legacy?.groupCode) continue;
    const key = normalized(group);
    const values = candidates.get(key) ?? new Set<string>();
    values.add(legacy.groupCode);
    candidates.set(key, values);
  }
  const inferredGroupCodes = new Map<string, string>();
  for (const [group, values] of candidates) {
    if (values.size === 1) inferredGroupCodes.set(group, [...values][0]!);
  }

  const overrides = new Map<string, FiscalOverride>();
  for (const [barcode, value] of Object.entries(config.fiscal.productOverrides ?? {})) {
    overrides.set(digits(barcode).replace(/^0+(?=\d)/, ''), value);
  }
  return { byBarcode, officialByBarcode, groupCst, inferredGroupCodes, overrides };
}

function buildAccessor(sheet: SheetData, row: string[]) {
  const ranges = faixasDaAba(sheet.sections, indexToCol, sheet.headers.length);
  const byColumn = (column: string | null): string => column ? text(row[colToIndex(column)]) : '';
  const cell = (name: string, store: Store | null = null, section?: string): string => byColumn(resolverDestino({
    nome: name,
    loja: store,
    faixa: section,
    faixas: ranges,
    cabecalhos: sheet.headers,
    letra: indexToCol,
  }));
  const unique = (name: string): string => {
    const wanted = normalized(name);
    const i = sheet.headers.findIndex((header) => normalized(header) === wanted);
    return i >= 0 ? text(row[i]) : '';
  };
  const cellLast = (name: string, section: string): string => {
    const range = ranges.find((item) => item.nome === normalized(section));
    if (!range) return '';
    const wanted = normalized(name);
    for (let i = range.fimIndice; i >= range.inicioIndice; i -= 1) {
      if (normalized(sheet.headers[i]) === wanted) return text(row[i]);
    }
    return '';
  };
  return { cell, cellLast, unique };
}

function rowToResult(
  config: StoreConfig,
  fiscal: FiscalContext,
  referenceRecords: Map<string, ReferenceRecord>,
  store: Store,
  sheet: SheetData,
  row: string[],
  rowNumber: number,
): ProductResult | null {
  const { cell, cellLast, unique } = buildAccessor(sheet, row);
  const name = unique('CADASTRO PRODUTOS ATUALIZADO NOVO');
  if (!name) return null;
  const id = unique('ID') || `${rowNumber}:${digits(cell('CODIGO BARRAS')) || normalized(name)}`;
  const key = `${store}:${id}`;
  const missing: string[] = [];

  const barcode = digits(cell('CODIGO BARRAS'));
  const barcodeKey = barcode.replace(/^0+(?=\d)/, '');
  const reference = referenceRecords.get(barcodeKey);
  const brand = cell('MARCAS');
  const resaleGroup = cell('GRUPO MERCADORIAS (REVENDA)');
  const transformationGroup = cell('GRUPO MERCADORIAS (TRANSFORMAÇÃO)');
  const groupName = resaleGroup || transformationGroup;
  const internalCode = digits(cell('CODIGO INT.', store));
  const cost = parseLocaleNumber(cell('CUSTO', store));
  const salePrice = parseLocaleNumber(cell('V. VENDA FINAL', store))
    ?? parseLocaleNumber(cell('V. VENDA', store))
    ?? parseLocaleNumber(cell('V. VENDA PONTUAL', store));
  /*
   * A unidade vem da coluna EMB.
   *
   * `MEDIDA BASE` existe no cabeçalho mas está VAZIA nas 7.369 linhas — medido
   * em 25/09/2026. Quem guarda a unidade é `EMB` (UN 6.720, KG 648, LT 1), e é
   * a coluna que o José mapeou. Ler só `MEDIDA BASE` bloqueava toda linha com
   * "unidade Criare".
   */
  const measure = cell('MEDIDA BASE') || unique('MEDIDA BASE') || unique('EMB');
  const packageQuantity = parseLocaleNumber(cell('QUANTIDADE')) ?? parseLocaleNumber(unique('QUANTIDADE')) ?? 0;
  const description = ProductRules.montarDescricao(
    name,
    packageQuantity,
    (measure || 'UN') as Parameters<typeof ProductRules.montarDescricao>[2],
  );

  // A faixa fiscal é compartilhada pelas lojas.
  const legacyFiscal = fiscal.byBarcode.get(barcodeKey);
  const officialFiscal = fiscal.officialByBarcode.get(barcodeKey);
  const override = fiscal.overrides.get(barcodeKey);
  // com `fiscalZerado`, nenhuma fonte fiscal é consultada: ver `StoreConfig`
  const zerado = config.fiscalZerado === true;
  const ncm = zerado ? FISCAL_ZERADO.ncm
    : (reference?.ncm.trim() || digits(cell('NCM')) || legacyFiscal?.ncm || officialFiscal?.ncm || digits(override?.ncm));
  const cest = zerado ? FISCAL_ZERADO.cest
    : (reference?.cest.trim() || digits(cell('CODIGO CEST')) || legacyFiscal?.cest || digits(override?.cest));
  const categoryName = cell('CATEGORIA');
  const ecfTaxCode = zerado ? FISCAL_ZERADO.ecfTaxCode
    : (reference?.ecfTaxCode.trim() || digits(cell('ALIQUOTA ECF ID')) || legacyFiscal?.ecfTaxCode || digits(override?.ecfTaxCode));
  const pisCofinsCst = zerado ? FISCAL_ZERADO.pisCofinsCst
    : (reference?.pisCofinsCst.trim()
      || legacyFiscal?.pisCofinsCst
      || digits(cell('CST PIS/COFINS'))
      || officialFiscal?.pisCofinsCst
      || fiscal.groupCst.get(normalized(groupName)));

  if (!barcode) missing.push('código de barras');
  if (!internalCode) missing.push(`código interno ${store}`);
  if (cost == null) missing.push(`custo ${store}`);
  if (salePrice == null) missing.push(`preço de venda ${store}`);
  if (!ncm) missing.push('NCM');
  if (!ecfTaxCode) missing.push('alíquota ECF ID');
  if (!pisCofinsCst) missing.push('CST PIS/COFINS');

  /*
   * O código do grupo vem da coluna ID GRUPO, e vem PRIMEIRO.
   *
   * Antes disto o robô só sabia traduzir o NOME do grupo por um de-para, que
   * está vazio na configuração — daí "sem de-para seguro para MER INATIVOS" em
   * todas as 7.369 linhas. Desde 25/09/2026 a planilha traz o número pronto:
   * 69 ids, 100% preenchidos, um id por grupo, sem ambiguidade. Traduzir nome
   * quando o número está escrito ao lado é inventar caminho para errar.
   */
  const groupCode = digits(unique('ID GRUPO'))
    || reference?.groupCode.trim()
    || text(config.groupCodes[groupName] ?? config.groupCodes[normalized(groupName)])
    || legacyFiscal?.groupCode
    || fiscal.inferredGroupCodes.get(normalized(groupName))
    || digits(override?.groupCode);
  if (!groupCode) missing.push(`código numérico do grupo (sem ID GRUPO nem de-para para "${groupName}")`);
  const categoryCode = zerado ? FISCAL_ZERADO.categoryCode
    : (reference?.categoryCode.trim()
      || text(config.categoryCodes[categoryName] ?? config.categoryCodes[normalized(categoryName)])
      || legacyFiscal?.categoryCode
      || digits(override?.categoryCode));
  if (!categoryCode) missing.push(`código da categoria Criare (sem fonte para "${categoryName || 'vazio'}")`);
  const unit = requireMapped(config.units, measure, 'unidade Criare', missing);

  // O layout tem datas de início/fim, mas a planilha guarda uma promoção
  // recorrente por dias/horários. Converter uma regra na outra por suposição
  // pode aplicar desconto fora da janela; por isso, promoção preenchida bloqueia.
  const promotionSection = `${store} - PROMOÇÃO`;
  const promotionValue = parseLocaleNumber(cellLast('PROMOÇÃO VALOR', promotionSection));
  // A faixa repete o cabeçalho: a primeira coluna é fórmula calculada e a
  // última é o dado digitado. Ler a primeira faria todo produto sem promoção
  // parecer ter -100% quando o preço calculado estivesse vazio.
  const promotionDiscount = parseLocaleNumber(cellLast('PROMOÇÃO DESC. %', promotionSection));
  if ((promotionValue ?? 0) !== 0 || (promotionDiscount ?? 0) !== 0) {
    missing.push('promoção: faltam datas compatíveis com o layout do Criare');
  }

  if (missing.length) return { key, name, row: rowNumber, store, missing };

  const code = internalCode.replace(/^0+(?=\d)/, '');
  const shortBarcode = config.barcodeField === 'short' ? barcode.padStart(13, '0') : '0'.repeat(13);
  const extendedBarcode = config.barcodeField === 'extended' ? barcode.padStart(14, '0') : '';
  const active = normalized(unique('V')) === 'INATIVO' ? 'N' : 'S';
  const weighable = config.weighableUnits.map(normalized).includes(normalized(measure)) ? 'S' : 'N';

  const values: Creare.CreareValues = {
    barcode: shortBarcode,
    groupCode,
    shortDescription: description,
    unitPrice: salePrice,
    unit,
    ecfTaxCode,
    promotionPrice: 0,
    internalCode: code.length <= 6 ? code : 0,
    // Marca não é fornecedor. Sem uma fonte específica, usamos o literal
    // homologado do SIA (zeros) em vez de deslocar a marca para este campo.
    supplierManufacturer: reference?.supplierManufacturer ?? '0'.repeat(40),
    reference: reference?.reference ?? '0'.repeat(30),
    basketKit: 'N',
    cost,
    description,
    basketCode: 0,
    promotionStart: config.noPromotionDate,
    promotionEnd: config.noPromotionDate,
    quantity: reference ? impliedNumber(reference.quantity, 3) : 0,
    iat: reference?.iat.trim() || config.iat,
    ippt: reference?.ippt.trim() || (transformationGroup ? 'P' : 'T'),
    ncm,
    reserved: reference?.reserved ?? '',
    extendedInternalCode: code,
    weighable: reference?.weighable.trim() || weighable,
    scaleKey: reference ? impliedNumber(reference.scaleKey, 0) : 0,
    cest: cest || null,
    // as alíquotas seguem a mesma regra dos códigos: zeradas quando `fiscalZerado`
    icmsReduction: zerado ? 0 : reference ? impliedNumber(reference.icmsReduction, config.decimalPlaces.icmsReduction) : parseImplied(cell('REDUCAO_ICMS') || legacyFiscal?.icmsReduction || override?.icmsReduction, config.decimalPlaces.icmsReduction) ?? 0,
    fullTaxRate: zerado ? 0 : reference ? impliedNumber(reference.fullTaxRate, config.decimalPlaces.fullTaxRate) : parseImplied(cell('ALIQUOTA CHEIA') || legacyFiscal?.fullTaxRate || override?.fullTaxRate, config.decimalPlaces.fullTaxRate) ?? 0,
    fcpRate: zerado ? 0 : reference ? impliedNumber(reference.fcpRate, config.decimalPlaces.fcpRate) : parseImplied(cell('ALIQUOTA FCP') || legacyFiscal?.fcpRate || override?.fcpRate, config.decimalPlaces.fcpRate) ?? 0,
    pisCofinsCst,
    pisRate: zerado ? 0 : reference ? impliedNumber(reference.pisRate, config.decimalPlaces.pisRate) : parseImplied(cell('ALIQUOTA PIS') || legacyFiscal?.pisRate || override?.pisRate, config.decimalPlaces.pisRate) ?? 0,
    cofinsRate: zerado ? 0 : reference ? impliedNumber(reference.cofinsRate, config.decimalPlaces.cofinsRate) : parseImplied(cell('ALIQUOTA COFINS') || legacyFiscal?.cofinsRate || override?.cofinsRate, config.decimalPlaces.cofinsRate) ?? 0,
    maximumQuantity: parseLocaleNumber(cell('ESTOQUE MAX', store)) ?? 0,
    minimumQuantity: parseLocaleNumber(cell('ESTOQUE MIN', store)) ?? 0,
    extendedBarcode,
    active,
    stockControlled: reference?.stockControlled.trim() || config.stockControlled,
    originId: reference ? impliedNumber(reference.originId, 0) : 0,
    originFactor: reference ? impliedNumber(reference.originFactor, 3) : 0,
    scaleValidity: reference ? impliedNumber(reference.scaleValidity, 0) : 0,
    categoryCode,
  };

  try {
    const record = Creare.serializeCreareRecord(values, config.decimalPlaces);
    return { key, name, row: rowNumber, store, record, hash: sha256(record), missing: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { key, name, row: rowNumber, store, missing: [`serialização: ${message}`] };
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function runOnce(config: BotConfig): Promise<void> {
  await mkdir(config.outputDir, { recursive: true });
  const stateFile = path.join(config.outputDir, '.creare-planilha-state.json');
  const reportFile = path.join(config.outputDir, 'ultimo-diagnostico.json');
  const state = await loadState(stateFile);
  const sheet = await readSheet(config);
  /*
   * As tabelas fiscais só são lidas se alguma loja ligada ainda precisar
   * delas. Com tudo zerado, são duas planilhas a menos por rodada — e uma
   * delas é a planilha antiga, que não deveria mais ser fonte de nada.
   */
  const algumaLojaComFiscal = Object.values(config.stores)
    .some((loja) => loja?.enabled && loja.fiscalZerado !== true);
  const fiscal: FiscalContext = algumaLojaComFiscal
    ? await loadFiscalContext(config, sheet)
    : {
      byBarcode: new Map(),
      officialByBarcode: new Map(),
      groupCst: new Map(),
      inferredGroupCodes: new Map(),
      overrides: new Map(Object.entries(config.fiscal.productOverrides ?? {})),
    };
  const referenceRecords = await loadReferenceRecords(config);
  const results: ProductResult[] = [];

  sheet.rows.forEach((row, index) => {
    for (const store of ['TNP', 'LI'] as const) {
      const storeConfig = config.stores[store];
      if (!storeConfig?.enabled) continue;
      const result = rowToResult(storeConfig, fiscal, referenceRecords, store, sheet, row, config.firstDataRow + index);
      if (!result) continue;
      if (productFilter && !result.name.toLocaleUpperCase('pt-BR').includes(productFilter)) continue;
      results.push(result);
    }
  });

  const files: string[] = [];
  const now = new Date().toISOString();
  for (const store of ['TNP', 'LI'] as const) {
    const storeConfig = config.stores[store];
    if (!storeConfig?.enabled) continue;
    const eligible = results.filter((r) => r.store === store && r.record && r.hash);
    const changed = eligible.filter((r) => force || (!state.initialized ? false : state.products[r.key]?.lastExportedHash !== r.hash));

    if (changed.length) {
      const ending = storeConfig.lineEnding === 'CRLF' ? '\r\n' : '\n';
      const file = path.join(config.outputDir, `creare-${store.toLowerCase()}-${timestamp()}.txt`);
      await atomicWrite(file, `${changed.map((r) => r.record).join(ending)}${ending}`);
      files.push(file);
      for (const r of changed) {
        state.products[r.key] = { name: r.name, row: r.row, updatedAt: now, lastExportedHash: r.hash };
      }
    }

    // Primeira execução normal cria baseline e não despeja o catálogo todo.
    if (!state.initialized && !force) {
      for (const r of eligible) {
        state.products[r.key] = { name: r.name, row: r.row, updatedAt: now, lastExportedHash: r.hash };
      }
    }
  }

  // Uma inspeção filtrada/forçada não equivale a fotografar o catálogo
  // inteiro. Marcá-la como baseline faria a execução seguinte entender todo o
  // restante como produto novo e gerar uma avalanche de arquivos.
  if (!productFilter && !force) state.initialized = true;
  await atomicWrite(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const incomplete = results.filter((r) => r.missing.length > 0);
  const report = {
    checkedAt: now,
    spreadsheetId: config.spreadsheetId,
    sheetName: config.sheetName,
    productFilter: productFilter ?? null,
    generatedFiles: files,
    complete: results.length - incomplete.length,
    incomplete: incomplete.map((r) => ({
      store: r.store, row: r.row, name: r.name, missing: r.missing,
    })),
  };
  await atomicWrite(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Verificados: ${results.length}; completos: ${report.complete}; incompletos: ${incomplete.length}.`);
  for (const file of files) console.log(`TXT gerado: ${file}`);
  for (const r of incomplete.slice(0, 20)) console.log(`BLOQUEADO ${r.store} linha ${r.row} ${r.name}: ${r.missing.join('; ')}`);
  if (incomplete.length > 20) console.log(`... e mais ${incomplete.length - 20} incompletos; veja ${reportFile}`);
}

async function main(): Promise<void> {
  const config = await loadConfig();
  do {
    try {
      await runOnce(config);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ERRO:`, error instanceof Error ? error.message : error);
      if (!watch) process.exitCode = 1;
    }
    if (!watch) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(10, config.pollIntervalSeconds) * 1000));
  } while (true);
}

void main();
