import { describe, expect, it } from 'vitest';
import type { ProductEntity } from '../product/product.schemas';
import {
  CreareValidationError,
  formatCreareAlpha,
  formatCreareNumber,
  generateCreareFile,
  generateCreareRecord,
  normalizeCreareText,
  parseCreareRecord,
  type CreareStoreConfig,
} from './creare.generator';
import {
  CREARE_PRODUCT_LAYOUT,
  CREARE_PRODUCT_RECORD_LENGTH,
  creareProductPositions,
} from './creare.layout';

const config: CreareStoreConfig = {
  groupCodes: { 'PRODUTOS DA CASA': '0005' },
  categoryCodes: { '3': '000000003' },
  units: { UN: 'UN', KG: 'KG', G: 'UN', LT: 'LT', ML: 'UN' },
  ecfTaxCodesByGroup: { 'PRODUTOS DA CASA': '01' },
  decimalPlaces: {
    unitPrice: 2, icmsReduction: 2, fullTaxRate: 2, fcpRate: 2,
    pisRate: 4, cofinsRate: 4, maximumQuantity: 3, minimumQuantity: 3,
  },
  barcodeField: 'automatic',
  lineEnding: 'CRLF',
  noPromotionDate: '30/12/99',
  iat: 'A',
  ipptByProductType: { revenda: 'T', transformacao: 'P' },
  weighableByMeasure: { UN: 'N', KG: 'S', G: 'N', LT: 'N', ML: 'N' },
  stockControlledByProductType: { revenda: 'S', transformacao: 'S' },
};

const bread = (overrides: Partial<ProductEntity> = {}): ProductEntity => ({
  id: '019c1f58-472e-7000-8000-000000000001',
  codigo: 'PR-TEST-0001',
  loja: 'TNP',
  baseProductId: null,
  createdByName: 'Teste',
  createdAt: '2026-08-25T12:00:00.000Z',
  nome: 'PÃO DE SAL PRALIS',
  quantidade: 0,
  medidaBase: 'KG',
  codigoBarras: null,
  marca: null,
  embalagem: null,
  cDe: null,
  qtCad: 1,
  medidaCompra: null,
  codigoInterno: '100000',
  fotoUrl: null,
  grupo: 'PRODUTOS DA CASA',
  tipo: 'transformacao',
  status: 'ativo',
  habilitarAjuda: false,
  estoqueMin: 0,
  estoqueMax: 0,
  setorEstoque: null,
  custo: 0.1,
  margemPontual: null,
  vVendaPontual: 21.99,
  auto: false,
  localVenda1: null,
  localVenda2: null,
  promocoes: [],
  transformacao: {
    precisao: 'EXATOS', qtd: 1, unidade: 'UN', produtoReceituario: null, refReceituario: null,
  },
  fiscal: {
    ncm: '1905.90.90', cest: '17.062.03', categoria: '3', cstPisCofins: '99',
    aliquotaCheia: 0, aliquotaFcp: 0, aliquotaPis: 0, aliquotaCofins: 0,
    reducaoIcms: 0, icms: 18, tributacaoSimples: null, aliquotaSimples: null,
    icmsRe: null, baseFiscal: null, codigoFiscal: null, produtoFiscal: null,
    cstReforma: null, cClassTrib: null, aliquotaIbs: null, aliquotaCbs: null,
    origemFiscal: null,
  },
  ...overrides,
});

describe('layout Criare de produto', () => {
  it('tem 40 campos e fecha exatamente em 363 posicoes', () => {
    expect(CREARE_PRODUCT_LAYOUT).toHaveLength(40);
    expect(CREARE_PRODUCT_RECORD_LENGTH).toBe(363);
    const positions = Object.fromEntries(creareProductPositions().map((field) => [field.name, [field.start, field.end]]));
    expect(positions.internalCode).toEqual([66, 71]);
    expect(positions.supplierManufacturer).toEqual([72, 111]);
    expect(positions.reserved).toEqual([245, 248]);
    expect(positions.categoryCode).toEqual([355, 363]);
  });

  it('decodifica sem deslocamento o primeiro registro real fornecido', () => {
    // Campos copiados do primeiro registro não vazio do TXT fornecido. A
    // composição explícita preserva os espaços significativos da fixture.
    const sample = [
      '0000000000000', '0005', 'SKOL 473ML'.padEnd(24), '0000000690', 'UN', '10',
      '0000000000', '013120', '0'.repeat(40), '0'.repeat(30), 'N', '0000000100',
      'SKOL 473ML'.padEnd(50), '000000', '30/12/99', '30/12/99', '0000000096',
      'A', 'T', '22030000', '    ', '000013120', 'N', '000', '0302103', '0000',
      '00000', '0000', '99', '00000000', '00000000', '0000048000', '0000012000',
      '07891149100828', 'S', 'S', '000000', '0000000000', '000', '000000003',
    ].join('');
    expect(sample).toHaveLength(363);
    const parsed = parseCreareRecord(sample);
    expect(parsed.shortDescription.trim()).toBe('SKOL 473ML');
    expect(parsed.unitPrice).toBe('0000000690');
    expect(parsed.ncm).toBe('22030000');
    expect(parsed.reserved).toBe('    ');
    expect(parsed.cest).toBe('0302103');
    expect(parsed.extendedBarcode).toBe('07891149100828');
    expect(parsed.categoryCode).toBe('000000003');
  });
});

describe('formatadores Criare', () => {
  it('gera apenas ASCII, mantendo um byte por caractere', () => {
    expect(normalizeCreareText('PÃO  DE\tSAL')).toBe('PAO DE SAL');
    expect(formatCreareAlpha('PÃO', 6)).toBe('PAO   ');
  });

  it('aplica decimais implicitos e rejeita overflow/ausencia', () => {
    expect(formatCreareNumber(6.9, 10, 2)).toBe('0000000690');
    expect(formatCreareNumber(0.1, 10, 3)).toBe('0000000100');
    expect(() => formatCreareNumber(12345678901, 10)).toThrow(/nao cabe/);
    expect(() => formatCreareNumber(null, 10)).toThrow(/ausente/);
  });
});

describe('gerador Criare estrito', () => {
  it('gera o pao de sal com os valores explicitamente configurados', () => {
    const record = generateCreareRecord(bread(), config);
    expect(record).toHaveLength(363);
    const parsed = parseCreareRecord(record);
    expect(parsed.shortDescription.trim()).toBe('PAO DE SAL PRALIS 0 KG');
    expect(parsed.unitPrice).toBe('0000002199');
    expect(parsed.cost).toBe('0000000100');
    expect(parsed.unit).toBe('KG');
    expect(parsed.groupCode).toBe('0005');
    expect(parsed.ecfTaxCode).toBe('01');
    expect(parsed.internalCode).toBe('100000');
    expect(parsed.extendedInternalCode).toBe('000000000');
    expect(parsed.ncm).toBe('19059090');
    expect(parsed.cest).toBe('1706203');
    expect(parsed.weighable).toBe('S');
    expect(parsed.ippt).toBe('P');
    expect(parsed.categoryCode).toBe('000000003');
  });

  it('usa somente o campo interno estendido para codigo com 7 a 9 digitos', () => {
    const parsed = parseCreareRecord(generateCreareRecord(bread({ codigoInterno: '1234567' }), config));
    expect(parsed.internalCode).toBe('000000');
    expect(parsed.extendedInternalCode).toBe('001234567');
  });

  it('calcula o preco automatico pelas regras compartilhadas', () => {
    const parsed = parseCreareRecord(generateCreareRecord(bread({ auto: true, custo: 10, margemPontual: 0.5 }), config));
    expect(parsed.unitPrice).toBe('0000001500');
  });

  it.each([
    ['grupo sem de-para', { grupo: 'SEM MAPA' }, /Codigo do grupo/],
    ['categoria sem de-para', { fiscal: { ...bread().fiscal!, categoria: 'OUTRA' } }, /Categoria Criare/],
    ['codigo interno grande', { codigoInterno: '1234567890' }, /excede 9/],
    ['EAN grande', { codigoBarras: '123456789012345' }, /excede 14/],
    ['promocao sem datas', { promocoes: [{ tipo: 'valor' as const, valor: 10, descontoPct: null, horaInicio: null, horaFim: null, dias: [true, true, true, true, true, true, true], descontoAte: null }] }, /Promocao nao pode/],
  ])('recusa %s em vez de inventar ou truncar', (_name, overrides, expected) => {
    expect(() => generateCreareRecord(bread(overrides as Partial<ProductEntity>), config)).toThrow(expected as RegExp);
  });

  it('recusa preco automatico sem margem', () => {
    expect(() => generateCreareRecord(bread({ auto: true, margemPontual: null }), config)).toThrow(/Margem pontual ausente/);
  });

  it('gera arquivo com a quebra explicitamente configurada', () => {
    const file = generateCreareFile([bread()], config);
    expect(file).toHaveLength(365);
    expect(file.endsWith('\r\n')).toBe(true);
    expect(file.slice(0, -2)).toHaveLength(363);
  });

  it('expõe erro tipado e identifica o produto', () => {
    try {
      generateCreareRecord(bread({ codigoInterno: null }), config);
      throw new Error('deveria falhar');
    } catch (error) {
      expect(error).toBeInstanceOf(CreareValidationError);
      expect((error as Error).message).toContain('PR-TEST-0001');
    }
  });
});

describe('casamento no SIA manda no coditem, no grupo e na aliquota', () => {
  const sia = {
    coditem: '012345',
    codGrupo: '0042',
    aliqSaidaEcf: '10',
    ncm: '22030000',
  };

  /*
   * O importador decide inserir ou ATUALIZAR pelo coditem. O TXT real do
   * fornecedor preenche os dois campos com o mesmo codigo; espelhar isso faz
   * ele achar a chave independente de qual campo leia.
   */
  it('grava o coditem do SIA nos DOIS campos de codigo interno', () => {
    const parsed = parseCreareRecord(generateCreareRecord(bread({ codigoInterno: null }), config, sia));

    expect(parsed.internalCode).toBe('012345');
    expect(parsed.extendedInternalCode).toBe('000012345');
  });

  it('usa a aliquota de ECF do SIA e IGNORA o de-para por grupo', () => {
    // a config mapeia o grupo para 01; o SIA diz 10, e o SIA e quem manda
    const parsed = parseCreareRecord(generateCreareRecord(bread({ codigoInterno: null }), config, sia));

    expect(parsed.ecfTaxCode).toBe('10');
    expect(config.ecfTaxCodesByGroup?.['PRODUTOS DA CASA']).toBe('01');
  });

  it('usa o grupo e o NCM do SIA — sao os valores que as foreign keys aceitam', () => {
    const parsed = parseCreareRecord(generateCreareRecord(bread({ codigoInterno: null }), config, sia));

    expect(parsed.groupCode).toBe('0042');
    expect(parsed.ncm).toBe('22030000');
  });

  it('cai no NCM do proprio produto quando o SIA nao tem', () => {
    const parsed = parseCreareRecord(
      generateCreareRecord(bread({ codigoInterno: null }), config, { ...sia, ncm: '' }),
    );

    expect(parsed.ncm).toBe('19059090');
  });

  /*
   * A recusa que protege o catalogo do PDV: o importador zera o codbarra de
   * quem ja o tinha antes de gravar. Se o casamento por barras apontar para
   * um produto diferente do que se pretende escrever, parar e o certo.
   */
  it('RECUSA quando o codigo interno do Pralis diverge do coditem do SIA', () => {
    expect(() => generateCreareRecord(bread({ codigoInterno: '999999' }), config, sia))
      .toThrow(/diverge do coditem/);
  });

  it('aceita quando os dois codigos sao o mesmo numero com zeros a esquerda', () => {
    const parsed = parseCreareRecord(generateCreareRecord(bread({ codigoInterno: '12345' }), config, sia));

    expect(parsed.internalCode).toBe('012345');
  });

  it('o registro continua com 363 bytes ASCII', () => {
    const registro = generateCreareRecord(bread({ codigoInterno: null }), config, sia);

    expect(registro).toHaveLength(363);
    expect(/^[\x20-\x7e]+$/.test(registro)).toBe(true);
  });

  it('generateCreareFile entrega o casamento produto a produto', () => {
    const a = bread({ id: 'a', codigo: 'A', codigoInterno: null });
    const b = bread({ id: 'b', codigo: 'B', codigoInterno: null });
    const porId = new Map([['a', sia], ['b', { ...sia, coditem: '067890', aliqSaidaEcf: '03' }]]);

    const linhas = generateCreareFile([a, b], config, (p) => porId.get(p.id)).split(String.fromCharCode(13) + String.fromCharCode(10));

    expect(parseCreareRecord(linhas[0]!).internalCode).toBe('012345');
    expect(parseCreareRecord(linhas[1]!).internalCode).toBe('067890');
    expect(parseCreareRecord(linhas[1]!).ecfTaxCode).toBe('03');
  });
});
