import type { ProductEntity } from '../product/product.schemas';
import { calcularVVenda, montarDescricao } from '../product/product.rules';
import {
  CREARE_PRODUCT_LAYOUT,
  CREARE_PRODUCT_RECORD_LENGTH,
  type CreareDecimalPlaces,
  type CreareFieldName,
  type CreareRawRecord,
} from './creare.layout';

type YesNo = 'S' | 'N';
type ProductType = ProductEntity['tipo'];
type Measure = ProductEntity['medidaBase'];

export interface CreareStoreConfig {
  groupCodes: Record<string, string>;
  categoryCodes: Record<string, string>;
  units: Record<string, string>;
  /**
   * Legado: alíquota de ECF por grupo comercial. Não é mais usado quando há
   * casamento no SIA — e não deveria ser usado nunca, porque o grupo não
   * determina a alíquota. Mantido opcional só para não quebrar configuração
   * antiga. Ver `docs/creare-aliquota-ecf.md`.
   */
  ecfTaxCodesByGroup?: Record<string, string>;
  decimalPlaces: CreareDecimalPlaces;
  barcodeField: 'short' | 'extended' | 'automatic';
  lineEnding: 'CRLF' | 'LF';
  noPromotionDate: string;
  iat: 'A' | 'T';
  ipptByProductType: Record<ProductType, 'P' | 'T'>;
  weighableByMeasure: Record<Measure, YesNo>;
  stockControlledByProductType: Record<ProductType, YesNo>;
}

/**
 * O que o produto JÁ É no cadastro do SIA, casado por código de barras.
 *
 * O importador do Criare decide inserir ou ATUALIZAR pelo `coditem`. Mandar um
 * código próprio faz ele inserir — e duplicar o catálogo. Por isso, na Fase 1,
 * exportar sem este casamento não é permitido.
 *
 * `codGrupo` e `ncm` também vêm daqui porque o banco do SIA tem foreign keys
 * (`produto.GRUPO` -> `grupo.CODGRUPO`): reaproveitar o valor que o produto já
 * tem garante que a trava nunca dispare.
 *
 * `aliqSaidaEcf` NÃO é derivado da situação fiscal. Ver
 * `docs/creare-aliquota-ecf.md`: sobre 4.186 produtos reais, produtos
 * fiscalmente idênticos têm códigos de ECF diferentes, então o código não é
 * função da situação fiscal. Copiar o do SIA reafirma o que o PDV já tem, em
 * vez de reescrever tributação como efeito colateral.
 */
export interface CreareSiaMatch {
  coditem: string;
  codGrupo: string;
  aliqSaidaEcf: string;
  ncm: string;
}

export class CreareValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: CreareFieldName,
  ) {
    super(message);
    this.name = 'CreareValidationError';
  }
}

export type CreareValues = Record<CreareFieldName, unknown>;

const digitsOnly = (value: unknown, label: string): string => {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new CreareValidationError(`${label} deve conter somente digitos.`);
  return text;
};

const requiredMapping = (
  map: Record<string, string>,
  key: string | null | undefined,
  label: string,
): string => {
  const normalizedKey = String(key ?? '').trim();
  if (!normalizedKey) throw new CreareValidationError(`${label}: valor de origem ausente.`);
  const mapped = map[normalizedKey];
  if (mapped == null || String(mapped).trim() === '') {
    throw new CreareValidationError(`${label}: nao existe de-para para "${normalizedKey}".`);
  }
  return String(mapped).trim();
};

/** Gera somente ASCII imprimível; em UTF-8 e CP1252 cada caractere ocupa 1 byte. */
export function normalizeCreareText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatCreareAlpha(value: unknown, length: number): string {
  return normalizeCreareText(value).slice(0, length).padEnd(length, ' ');
}

export function formatCreareNumber(value: unknown, length: number, decimals = 0): string {
  if (value === '' || value == null) {
    throw new CreareValidationError(`Valor numerico ausente para campo de ${length} posicoes.`);
  }
  const numeric = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new CreareValidationError(`Valor numerico invalido: "${String(value)}".`);
  }
  const scaled = Math.round(numeric * 10 ** decimals);
  const text = String(scaled);
  if (text.length > length) {
    throw new CreareValidationError(`Valor "${String(value)}" nao cabe em ${length} posicoes.`);
  }
  return text.padStart(length, '0');
}

function validateDate(value: unknown, field: CreareFieldName): string {
  const text = String(value ?? '');
  if (!/^\d{2}\/\d{2}\/\d{2}$/.test(text)) {
    throw new CreareValidationError(`Data "${text}" deve estar em DD/MM/AA.`, field);
  }
  return text;
}

export function serializeCreareRecord(values: CreareValues, decimalPlaces: CreareDecimalPlaces): string {
  const parts = CREARE_PRODUCT_LAYOUT.map((field) => {
    try {
      if (field.kind === 'alpha') return formatCreareAlpha(values[field.name], field.length);
      if (field.kind === 'date') return validateDate(values[field.name], field.name);
      const configuredDecimals = 'decimals' in field ? field.decimals : 0;
      const decimals = typeof configuredDecimals === 'string'
        ? decimalPlaces[configuredDecimals]
        : configuredDecimals;
      return formatCreareNumber(values[field.name], field.length, decimals);
    } catch (error) {
      if (error instanceof CreareValidationError && !error.field) {
        throw new CreareValidationError(`${field.name}: ${error.message}`, field.name);
      }
      throw error;
    }
  });
  const record = parts.join('');
  if (record.length !== CREARE_PRODUCT_RECORD_LENGTH || /[^\x20-\x7e]/.test(record)) {
    throw new CreareValidationError(
      `Registro invalido: esperado ${CREARE_PRODUCT_RECORD_LENGTH} bytes ASCII, obtido ${record.length}.`,
    );
  }
  return record;
}

function optionalFixedDigits(value: unknown, length: number, label: string): string {
  const text = String(value ?? '').trim();
  if (!text) return '0'.repeat(length);
  const digits = digitsOnly(text.replace(/[.\/-]/g, ''), label);
  if (digits.length > length) throw new CreareValidationError(`${label} nao cabe em ${length} posicoes.`);
  return digits.padStart(length, '0');
}

function requiredFixedDigits(value: unknown, length: number, label: string): string {
  const digits = digitsOnly(String(value ?? '').replace(/[.\/-]/g, ''), label);
  if (digits.length > length) throw new CreareValidationError(`${label} nao cabe em ${length} posicoes.`);
  return digits.padStart(length, '0');
}

function productCodes(
  product: ProductEntity,
  sia?: CreareSiaMatch,
): Pick<CreareValues, 'internalCode' | 'extendedInternalCode'> {
  if (sia) {
    const coditem = digitsOnly(sia.coditem, 'Coditem do SIA');
    if (coditem.length > 9) throw new CreareValidationError('Coditem do SIA excede 9 digitos.');
    /*
     * A recusa que o plano pede: se o produto do Pralis já carrega um código
     * interno numérico e ele é OUTRO, o casamento por barras está apontando
     * para um produto diferente do que se pretende escrever. Parar aqui é o
     * certo — seguir gravaria por cima do cadastro alheio no PDV.
     */
    const proprio = String(product.codigoInterno ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (proprio && proprio !== coditem.replace(/^0+(?=\d)/, '')) {
      throw new CreareValidationError(
        `Codigo interno do Pralis (${proprio}) diverge do coditem do SIA (${coditem}) para o mesmo codigo de barras.`,
      );
    }
    // o TXT do fornecedor preenche OS DOIS campos com o mesmo código; espelhar
    // isso deixa o importador achar a chave independente de qual ele leia
    return coditem.length <= 6
      ? { internalCode: coditem, extendedInternalCode: coditem }
      : { internalCode: 0, extendedInternalCode: coditem };
  }
  const code = digitsOnly(product.codigoInterno, 'Codigo interno');
  if (code.length > 9) throw new CreareValidationError('Codigo interno excede 9 digitos.');
  return code.length <= 6
    ? { internalCode: code, extendedInternalCode: 0 }
    : { internalCode: 0, extendedInternalCode: code };
}

function barcodeCodes(
  raw: string | null,
  strategy: CreareStoreConfig['barcodeField'],
): Pick<CreareValues, 'barcode' | 'extendedBarcode'> {
  if (!raw?.trim()) return { barcode: '', extendedBarcode: '' };
  const code = digitsOnly(raw, 'Codigo de barras');
  if (code.length > 14) throw new CreareValidationError('Codigo de barras excede 14 digitos.');
  const target = strategy === 'automatic' ? (code.length <= 13 ? 'short' : 'extended') : strategy;
  if (target === 'short') {
    if (code.length > 13) throw new CreareValidationError('Codigo de barras nao cabe no campo curto.');
    return { barcode: code, extendedBarcode: '' };
  }
  return { barcode: '', extendedBarcode: code };
}

function salePrice(product: ProductEntity): number {
  if (!product.auto) {
    if (product.vVendaPontual == null) throw new CreareValidationError('Preco de venda pontual ausente.');
    return product.vVendaPontual;
  }
  if (product.custo == null) throw new CreareValidationError('Custo ausente para calcular o preco automatico.');
  if (product.margemPontual == null) {
    throw new CreareValidationError('Margem pontual ausente para calcular o preco automatico.');
  }
  return calcularVVenda({
    auto: true,
    custo: product.custo,
    qtCad: product.qtCad,
    margemPontual: product.margemPontual,
    margemGrupo: 0,
    vVendaPontual: product.vVendaPontual ?? 0,
    descricao: product.nome,
  });
}

export function valuesFromProduct(
  product: ProductEntity,
  config: CreareStoreConfig,
  sia?: CreareSiaMatch,
): CreareValues {
  if (product.promocoes.length > 0) {
    throw new CreareValidationError('Promocao nao pode ser exportada: o Pralis nao possui as duas datas exigidas pelo layout.');
  }
  if (!product.fiscal) throw new CreareValidationError('Dados fiscais ausentes.');
  if (product.custo == null) throw new CreareValidationError('Custo ausente.');
  const fiscal = product.fiscal;
  const description = montarDescricao(product.nome, product.quantidade, product.medidaBase);
  /*
   * O que o PRODUTO carrega vem primeiro; SIA e de-para por nome são fallback.
   *
   * Até 26/09/2026 a ordem era a inversa, e fazia sentido quando o cadastro
   * não tinha esses campos: o casamento no SIA era a única fonte confiável.
   * A carga de 25/09 mudou isso — cada produto passou a trazer o próprio id
   * de grupo (coluna ID GRUPO da planilha, em `grupoId`) e o bloco fiscal
   * inteiro, zerado por decisão do José: *"tudo será completado com zeros"*.
   *
   * Se o SIA continuasse ganhando, um produto casado sairia com NCM e ECF
   * reais e o vizinho não casado sairia zerado — dois critérios no mesmo
   * arquivo, sem ninguém ter escolhido isso. Produto primeiro é o único jeito
   * de o TXT refletir o que está no cadastro.
   */
  const groupCode = product.grupoId?.trim()
    || sia?.codGrupo
    || requiredMapping(config.groupCodes, product.grupo, 'Codigo do grupo');
  /*
   * Categoria em branco vira zeros, não erro: é o estado de TODO produto da
   * carga. Categoria preenchida e sem de-para continua recusando — aí alguém
   * escreveu um nome que o Criare não conhece, e isso precisa aparecer.
   */
  const categoryCode = fiscal.categoria?.trim()
    ? requiredMapping(config.categoryCodes, fiscal.categoria, 'Categoria Criare')
    : '0'.repeat(9);
  const unit = requiredMapping(config.units, product.medidaBase, 'Unidade');
  const ecfTaxCode = fiscal.aliquotaEcfId?.trim()
    || sia?.aliqSaidaEcf
    || requiredMapping(config.ecfTaxCodesByGroup ?? {}, product.grupo, 'Aliquota ECF');
  const ncm = fiscal.ncm?.trim() || sia?.ncm?.trim() || '';
  const ippt = config.ipptByProductType[product.tipo];
  const weighable = config.weighableByMeasure[product.medidaBase];
  const stockControlled = config.stockControlledByProductType[product.tipo];
  if (!ippt || !weighable || !stockControlled) {
    throw new CreareValidationError('Defaults operacionais incompletos para tipo/medida do produto.');
  }

  return {
    ...productCodes(product, sia),
    ...barcodeCodes(product.codigoBarras, config.barcodeField),
    groupCode: requiredFixedDigits(groupCode, 4, 'Codigo do grupo'),
    shortDescription: description,
    unitPrice: salePrice(product),
    unit,
    ecfTaxCode: requiredFixedDigits(ecfTaxCode, 2, 'Aliquota ECF'),
    promotionPrice: 0,
    supplierManufacturer: product.marca ?? '',
    reference: '',
    basketKit: 'N',
    cost: product.custo,
    description,
    basketCode: 0,
    promotionStart: config.noPromotionDate,
    promotionEnd: config.noPromotionDate,
    quantity: 0,
    iat: config.iat,
    ippt,
    ncm: requiredFixedDigits(ncm, 8, 'NCM'),
    reserved: '',
    weighable,
    scaleKey: 0,
    cest: optionalFixedDigits(fiscal.cest, 7, 'CEST'),
    icmsReduction: fiscal.reducaoIcms ?? 0,
    fullTaxRate: fiscal.aliquotaCheia ?? 0,
    fcpRate: fiscal.aliquotaFcp ?? 0,
    pisCofinsCst: requiredFixedDigits(fiscal.cstPisCofins, 2, 'CST PIS/COFINS'),
    pisRate: fiscal.aliquotaPis ?? 0,
    cofinsRate: fiscal.aliquotaCofins ?? 0,
    maximumQuantity: product.estoqueMax ?? 0,
    minimumQuantity: product.estoqueMin ?? 0,
    active: product.status === 'ativo' ? 'S' : 'N',
    stockControlled,
    originId: 0,
    originFactor: 0,
    // '' virava tres espacos e o importador recusava o registro: ele le este
    // campo como inteiro. Ver a nota no layout.
    scaleValidity: 0,
    categoryCode: requiredFixedDigits(categoryCode, 9, 'Categoria Criare'),
  };
}

export function generateCreareRecord(
  product: ProductEntity,
  config: CreareStoreConfig,
  sia?: CreareSiaMatch,
): string {
  try {
    return serializeCreareRecord(valuesFromProduct(product, config, sia), config.decimalPlaces);
  } catch (error) {
    if (error instanceof CreareValidationError) {
      throw new CreareValidationError(`Produto ${product.codigo} (${product.nome}): ${error.message}`, error.field);
    }
    throw error;
  }
}

/**
 * `resolverSia` entrega o casamento de cada produto. Quem decide o que entra é
 * quem chama: a Fase 1 só manda produtos já casados, e conta os de fora.
 */
export function generateCreareFile(
  products: ProductEntity[],
  config: CreareStoreConfig,
  resolverSia?: (product: ProductEntity) => CreareSiaMatch | undefined,
): string {
  const ending = config.lineEnding === 'CRLF' ? '\r\n' : '\n';
  return products
    .map((product) => generateCreareRecord(product, config, resolverSia?.(product)))
    .join(ending) + (products.length ? ending : '');
}

export function parseCreareRecord(record: string): CreareRawRecord {
  if (record.length !== CREARE_PRODUCT_RECORD_LENGTH) {
    throw new CreareValidationError(
      `Registro deve ter ${CREARE_PRODUCT_RECORD_LENGTH} posicoes; recebeu ${record.length}.`,
    );
  }
  let offset = 0;
  const parsed = {} as CreareRawRecord;
  for (const field of CREARE_PRODUCT_LAYOUT) {
    parsed[field.name] = record.slice(offset, offset + field.length);
    offset += field.length;
  }
  return parsed;
}
