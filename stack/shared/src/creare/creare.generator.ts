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
  /**
   * Padrões para as duas chaves estrangeiras do SIA que ZERO não satisfaz.
   *
   * Provado no importador do Criare em 28/09/2026 (`trace_TDM_28_9_2026.log`):
   * `ALIQUOTASAIDA` tem de existir em `aliquotas.POSICAO` e `CST_PIS` em
   * `cstpis.ID`. Com `00` nos dois, o importador diz "SUCESSO" na leitura do
   * arquivo e depois recusa a gravação em `produto`, `estoques` e
   * `tributacaopiscofins` — o produto NÃO entra, e só o log conta.
   *
   * Por isso estes dois campos nunca saem zerados: vale o que o produto tem de
   * verdade, depois o que o SIA já tinha para aquele coditem, depois este
   * padrão. Sem nenhum dos três, o produto fica de fora com o motivo à vista.
   *
   * O valor é decisão fiscal de quem configura, nunca chute do código. No
   * arquivo homologado do Criare aparecem `03` (tributado) e `99`.
   */
  ecfTaxCodePadrao?: string;
  pisCofinsCstPadrao?: string;
  decimalPlaces: CreareDecimalPlaces;
  barcodeField: 'short' | 'extended' | 'automatic';
  lineEnding: 'CRLF' | 'LF';
  noPromotionDate: string;
  iat: 'A' | 'T';
  ipptByProductType: Record<ProductType, 'P' | 'T'>;
  /** Legado aceito no JSON do Coolify; não participa mais da geração do TXT. */
  weighableByMeasure?: Record<Measure, YesNo>;
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
  pesavel?: string | null;
  teclaBalanca?: string | null;
  validadeBalanca?: string | null;
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

/**
 * Um valor "de verdade": não vazio e não composto só de zeros.
 *
 * `00`, `00000000` e `0000000` são o marcador que a carga de 25/09/2026 gravou
 * no fiscal de todo produto para dizer "ainda não preenchido". Para o SIA, em
 * campo que é chave estrangeira, isso é chave inexistente. Tratar zeros como
 * ausência é o que permite a busca seguir para a fonte seguinte.
 */
const valorReal = (v: string | null | undefined): string => {
  const t = String(v ?? '').trim();
  return t && !/^0+$/.test(t) ? t : '';
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

/**
 * O coditem é a chave do produto no SIA e o código do produto na balança.
 * A balança (Toledo MGV) só aceita 1 a 999999 — em 06/10/2026 um único
 * "5STAR 40 G" com código 000000 derrubou a importação do ITENSMGV inteiro.
 * Zero nunca é código válido; e pesável com mais de 6 dígitos não cabe na
 * balança, mesmo que o SIA aceite até 9.
 */
function garantirCodigoNaFaixa(codigo: string, origem: string, weighable: 'S' | 'N') {
  if (Number(codigo) === 0) {
    throw new CreareValidationError(`${origem} e zero; o SIA e a balanca exigem codigo entre 1 e 999999.`);
  }
  if (weighable === 'S' && codigo.replace(/^0+(?=\d)/, '').length > 6) {
    throw new CreareValidationError(`${origem} (${codigo}) nao cabe na balanca: pesavel exige codigo entre 1 e 999999.`);
  }
}

function productCodes(
  product: ProductEntity,
  sia: CreareSiaMatch | undefined,
  weighable: 'S' | 'N',
): Pick<CreareValues, 'internalCode' | 'extendedInternalCode'> {
  if (sia) {
    const coditem = digitsOnly(sia.coditem, 'Coditem do SIA');
    if (coditem.length > 9) throw new CreareValidationError('Coditem do SIA excede 9 digitos.');
    garantirCodigoNaFaixa(coditem, 'Coditem do SIA', weighable);
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
  garantirCodigoNaFaixa(code, 'Codigo interno', weighable);
  return code.length <= 6
    ? { internalCode: code, extendedInternalCode: 0 }
    : { internalCode: 0, extendedInternalCode: code };
}

export function barcodeCodes(
  raw: string | null,
  strategy: CreareStoreConfig['barcodeField'],
): Pick<CreareValues, 'barcode' | 'extendedBarcode'> {
  // O importador SIA homologado le o GTIN no campo longo, alinhado a direita.
  // Manter o campo nao usado zerado, como no TXT que importou corretamente.
  const semCurto = '0'.repeat(13);
  const semLongo = '0'.repeat(14);
  if (!raw?.trim()) return { barcode: semCurto, extendedBarcode: semLongo };
  const code = digitsOnly(raw, 'Codigo de barras');
  if (code.length > 14) throw new CreareValidationError('Codigo de barras excede 14 digitos.');
  const target = strategy === 'automatic' ? (code.length <= 13 ? 'short' : 'extended') : strategy;
  if (target === 'short') {
    if (code.length > 13) throw new CreareValidationError('Codigo de barras nao cabe no campo curto.');
    return { barcode: code.padStart(13, '0'), extendedBarcode: semLongo };
  }
  return { barcode: semCurto, extendedBarcode: code.padStart(14, '0') };
}

/**
 * Preço de venda quando o cadastro não tem um: R$ 0,10.
 *
 * Decisão do José em 26/09/2026: *"coloque 0,10 centavos se não tiver"*. O
 * caso concreto era o produto INATIVO, que a planilha traz sem preço e que
 * ainda assim precisa chegar ao Creare — senão ele continua vendável no caixa,
 * porque o PDV só marca inativo quem ele conhece. Zero não serve: o layout
 * trata preço zero como ausência. Dez centavos é um valor que existe e que
 * ninguém confunde com preço de prateleira.
 */
export const PRECO_DE_VENDA_MINIMO = 0.1;

function salePrice(product: ProductEntity): number {
  if (!product.auto) return product.vVendaPontual ?? PRECO_DE_VENDA_MINIMO;
  // preço automático sem custo ou sem margem não tem como ser calculado
  if (product.custo == null || product.margemPontual == null) return PRECO_DE_VENDA_MINIMO;
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
  /*
   * Sem bloco fiscal não é mais recusa: é o estado de todo produto criado pelo
   * formulário da Base, onde o fiscal não aparece (ele é da loja, e vem pelo
   * backfill). Recusar aqui deixava o produto novo de 28/09/2026 fora do TXT
   * com "Dados fiscais ausentes". O bloco ausente vale como o bloco zerado da
   * carga: NCM, CEST e categoria em zeros (o SIA aceita), e ECF e CST PIS
   * pelo padrão da loja — exatamente como qualquer produto da carga.
   *
   * Custo ausente vira zero pelo mesmo motivo: o SIA aceita custo zero, e o
   * robô da planilha já mandava assim.
   */
  const fiscal: NonNullable<ProductEntity['fiscal']> = product.fiscal ?? {
    ncm: '00000000', cest: '0000000', categoria: null, cstPisCofins: null,
    aliquotaCheia: 0, aliquotaFcp: 0, aliquotaPis: 0, aliquotaCofins: 0, reducaoIcms: 0, icms: 0,
    tributacaoSimples: null, aliquotaSimples: null, icmsRe: null, baseFiscal: null, codigoFiscal: null,
    produtoFiscal: null, cstReforma: null, cClassTrib: null, aliquotaIbs: null, aliquotaCbs: null,
    origemFiscal: null, aliquotaEcf: null, aliquotaEcfId: null, estado: null, motivo: null, pctNcm: null,
  };
  const custo = product.custo ?? 0;
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
  /*
   * Placeholder não é valor. A carga de 25/09 gravou `00`, `00000000` e
   * `0000000` no fiscal de TODO produto, como marcador de "ainda não
   * preenchido". Para o SIA, porém, `00` em ECF ou CST PIS é chave estrangeira
   * inexistente e derruba a gravação do produto. Então um valor só de zeros
   * conta como AUSENTE, e a busca segue para o SIA e para o padrão da loja.
   */
  const groupCode = valorReal(product.grupoId)
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
  const ecfTaxCode = valorReal(fiscal.aliquotaEcfId)
    || valorReal(sia?.aliqSaidaEcf)
    || valorReal(config.ecfTaxCodePadrao)
    || requiredMapping(config.ecfTaxCodesByGroup ?? {}, product.grupo, 'Aliquota ECF');
  /*
   * CST PIS/COFINS não existe no de-para do SIA (o `cstSaida` de lá é o CST
   * de ICMS). Então é o do produto ou o padrão da loja; sem os dois, recusa
   * com o nome do campo — mandar `00` seria recusado pelo SIA do mesmo jeito,
   * só que em silêncio.
   */
  const pisCofinsCst = valorReal(fiscal.cstPisCofins) || valorReal(config.pisCofinsCstPadrao);
  if (!pisCofinsCst) {
    throw new CreareValidationError('CST PIS/COFINS ausente e sem pisCofinsCstPadrao configurado para a loja.');
  }
  // NCM não tem chave estrangeira no SIA: zero passa. Mesmo assim, prefira o real.
  /*
   * NCM vazio vira zeros. Não é chave estrangeira no SIA, e é o estado do
   * produto que a regra do grupo classificou sem NCM — o LIMPADOR de
   * 28/09/2026 caía em "NCM deve conter somente digitos" por um campo vazio.
   */
  const ncm = valorReal(fiscal.ncm) || valorReal(sia?.ncm) || '0'.repeat(8);
  const ippt = config.ipptByProductType[product.tipo];
  // Pesavel e uma propriedade operacional do cadastro SIA, nao da unidade.
  // Um item UN pode ser de balanca; inferir N sobrescreve o S existente.
  if (product.pesavel && sia?.pesavel && product.pesavel !== sia.pesavel) {
    throw new CreareValidationError('Pesavel diverge entre Pralis e espelho SIA; confira o cadastro atual antes de exportar.');
  }
  if (product.teclaBalanca != null && sia?.teclaBalanca != null
    && product.teclaBalanca !== Number(sia.teclaBalanca)) {
    throw new CreareValidationError('Tecla de balanca diverge entre Pralis e espelho SIA.');
  }
  if (product.validadeBalanca != null && sia?.validadeBalanca != null
    && product.validadeBalanca !== Number(sia.validadeBalanca)) {
    throw new CreareValidationError('Validade de balanca diverge entre Pralis e espelho SIA.');
  }
  // O produto da loja pode declarar o valor; para os existentes vale o espelho
  // SIA. Nenhuma chamada (inclusive isolada) pode inferir pela unidade.
  const weighable = product.pesavel ?? sia?.pesavel;
  if (weighable !== 'S' && weighable !== 'N') {
    throw new CreareValidationError('Pesavel sem confirmacao no cadastro SIA; exportacao bloqueada.');
  }
  const tecla = product.teclaBalanca == null ? sia?.teclaBalanca ?? (weighable === 'S' ? null : '0') : String(product.teclaBalanca);
  const validade = product.validadeBalanca == null ? sia?.validadeBalanca ?? (weighable === 'S' ? null : '0') : String(product.validadeBalanca);
  if (tecla === null || validade === null || !/^\d{1,3}$/.test(tecla) || !/^\d{1,3}$/.test(validade)) {
    throw new CreareValidationError('Tecla ou validade de balanca sem confirmacao no cadastro SIA.');
  }
  const stockControlled = config.stockControlledByProductType[product.tipo];
  if (!ippt || !weighable || !stockControlled) {
    throw new CreareValidationError('Defaults operacionais incompletos para tipo/medida do produto.');
  }

  return {
    ...productCodes(product, sia, weighable),
    ...barcodeCodes(product.codigoBarras, config.barcodeField),
    groupCode: requiredFixedDigits(groupCode, 4, 'Codigo do grupo'),
    shortDescription: description,
    unitPrice: salePrice(product),
    unit,
    ecfTaxCode: requiredFixedDigits(ecfTaxCode, 2, 'Aliquota ECF'),
    promotionPrice: 0,
    /*
     * Vazio sai como zeros, não como espaços: é a forma do registro que o
     * próprio Criare gera (`txt gerado pelo funcionario do creare.txt`, 28/09).
     * Espaço o importador tolerou, mas o arquivo de referência é a homologação.
     */
    supplierManufacturer: product.marca?.trim() || '0'.repeat(40),
    reference: '0'.repeat(30),
    basketKit: 'N',
    cost: custo,
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
    scaleKey: Number(tecla),
    cest: optionalFixedDigits(fiscal.cest, 7, 'CEST'),
    icmsReduction: fiscal.reducaoIcms ?? 0,
    fullTaxRate: fiscal.aliquotaCheia ?? 0,
    fcpRate: fiscal.aliquotaFcp ?? 0,
    pisCofinsCst: requiredFixedDigits(pisCofinsCst, 2, 'CST PIS/COFINS'),
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
    scaleValidity: Number(validade),
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
