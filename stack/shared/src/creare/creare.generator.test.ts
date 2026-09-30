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
    unitPrice: 2, cost: 3, icmsReduction: 2, fullTaxRate: 2, fcpRate: 2,
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
  compraAproximada: false,
  baseProductId: null,
  createdByName: 'Teste',
  createdAt: '2026-08-25T12:00:00.000Z',
  nome: 'PÃO DE SAL PRALIS',
  quantidade: 0,
  medidaBase: 'KG',
  pesavel: 'S',
  teclaBalanca: 0,
  validadeBalanca: 0,
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
  setorVenda1: null,
  setorVenda2: null,
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
    aliquotaEcf: null,
    aliquotaEcfId: null,
    estado: null,
    motivo: null,
    pctNcm: null,
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
    /*
     * Sem o "0" desde 09/09/2026. Este e o texto que vai para o SIA: o pao de
     * sal e vendido por quilo e nao tem gramatura, entao "0 KG" afirmava um
     * peso que nao existe. Aqui a mudanca deixa de ser cosmetica — e o nome do
     * produto no sistema fiscal.
     */
    expect(parsed.shortDescription.trim()).toBe('PAO DE SAL PRALIS KG');
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

  it('preco ausente vira R$ 0,10 em vez de recusar', () => {
    /*
     * Desde 26/09/2026 preço ausente não recusa: vai R$ 0,10. O caso é o
     * produto inativo, que a planilha traz sem preço e que precisa chegar ao
     * Creare para o PDV saber que ele está inativo.
     */
    const semMargem = parseCreareRecord(generateCreareRecord(bread({ auto: true, margemPontual: null }), config));
    // o layout guarda o preço em 10 posições com 2 decimais implícitos: 0,10 = 0000000010
    expect(semMargem.unitPrice).toBe('0000000010');
    const semPreco = parseCreareRecord(generateCreareRecord(bread({ auto: false, vVendaPontual: null }), config));
    expect(semPreco.unitPrice).toBe('0000000010');
    // quem tem preço continua com o seu
    expect(parseCreareRecord(generateCreareRecord(bread(), config)).unitPrice).toBe('0000002199');
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
    pesavel: 'S',
    teclaBalanca: '0',
    validadeBalanca: '0',
  };

  it('preserva S e os campos de balanca mesmo quando a medida no Pralis e UN', () => {
    const parsed = parseCreareRecord(generateCreareRecord(
      bread({ codigoInterno: null, medidaBase: 'UN', teclaBalanca: null, validadeBalanca: null }),
      config,
      { ...sia, teclaBalanca: '12', validadeBalanca: '2' },
    ));
    expect(parsed.weighable).toBe('S');
    expect(parsed.scaleKey).toBe('012');
    expect(parsed.scaleValidity).toBe('002');
  });

  it('recusa cadastro SIA sem classificacao de balanca', () => {
    expect(() => generateCreareRecord(bread({ codigoInterno: null, pesavel: null }), config, { ...sia, pesavel: null }))
      .toThrow(/Pesavel sem confirmacao/);
  });

  it('recusa tecla de balanca divergente entre produto e SIA', () => {
    expect(() => generateCreareRecord(bread({ teclaBalanca: 7 }), config, sia))
      .toThrow(/Tecla de balanca diverge/);
  });

  it('recusa produto isolado sem Pesavel, mesmo que a medida seja KG', () => {
    expect(() => generateCreareRecord(bread({ pesavel: null }), config)).toThrow(/Pesavel sem confirmacao/);
  });

  it('mantem N explicitamente confirmado mesmo quando a medida e KG', () => {
    const parsed = parseCreareRecord(generateCreareRecord(bread({ pesavel: 'N', teclaBalanca: null, validadeBalanca: null }), config));
    expect(parsed.weighable).toBe('N');
    expect(parsed.scaleKey).toBe('000');
    expect(parsed.scaleValidity).toBe('000');
  });

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

  /*
   * Desde 26/09/2026 o que o PRODUTO carrega vem primeiro; o SIA e o de-para
   * por nome sao fallback. Antes era o inverso, e com a carga zerada isso
   * produziria um arquivo com dois criterios: produto casado no SIA com NCM
   * real, vizinho nao casado zerado.
   */
  it('o NCM do proprio produto vence o do SIA; o grupo do SIA entra so sem grupoId', () => {
    const parsed = parseCreareRecord(generateCreareRecord(bread({ codigoInterno: null }), config, sia));

    expect(parsed.ncm).toBe('19059090'); // do produto, nao 22030000 do SIA
    expect(parsed.groupCode).toBe('0042'); // o fixture nao tem grupoId: SIA e o fallback
  });

  it('cai no NCM do SIA so quando o produto nao tem', () => {
    const semNcm = bread({ codigoInterno: null, fiscal: { ...bread().fiscal!, ncm: '' } });
    expect(parseCreareRecord(generateCreareRecord(semNcm, config, sia)).ncm).toBe('22030000');
  });

  it('o id de grupo do produto vence o SIA e o de-para por nome', () => {
    // e a coluna ID GRUPO da planilha, guardada em `grupoId` pela carga
    const parsed = parseCreareRecord(
      generateCreareRecord(bread({ codigoInterno: null, grupoId: '102' }), config, sia),
    );
    expect(parsed.groupCode).toBe('0102');
  });

  it('a aliquota ECF real do produto vence o SIA; zero e placeholder e cai no SIA', () => {
    /*
     * Provado no importador do Criare em 28/09/2026: `00` em ALIQUOTASAIDA e
     * chave estrangeira inexistente em `aliquotas.POSICAO`. O produto nao
     * grava. Entao zero conta como ausente e a busca segue.
     */
    const real = bread({ codigoInterno: null, fiscal: { ...bread().fiscal!, aliquotaEcfId: '11' } });
    expect(parseCreareRecord(generateCreareRecord(real, config, sia)).ecfTaxCode).toBe('11');
    const zerado = bread({ codigoInterno: null, fiscal: { ...bread().fiscal!, aliquotaEcfId: '00' } });
    expect(parseCreareRecord(generateCreareRecord(zerado, config, sia)).ecfTaxCode).toBe('10'); // do SIA
  });

  it('sem SIA e com ECF zerado, vale o padrao da loja; sem padrao, recusa com o nome do campo', () => {
    const zerado = bread({ grupoId: '65', fiscal: { ...bread().fiscal!, aliquotaEcfId: '00' } });
    const semMapaDeGrupo = { ...config, ecfTaxCodesByGroup: {} };
    expect(parseCreareRecord(generateCreareRecord(zerado, { ...semMapaDeGrupo, ecfTaxCodePadrao: '03' })).ecfTaxCode).toBe('03');
    expect(() => generateCreareRecord(zerado, semMapaDeGrupo)).toThrow(/Aliquota ECF/);
  });

  it('CST PIS/COFINS zerado usa o padrao da loja; sem padrao, recusa', () => {
    // o de-para do SIA nao tem CST de PIS (o `cstSaida` de la e o de ICMS)
    const zerado = bread({ fiscal: { ...bread().fiscal!, cstPisCofins: '00' } });
    expect(parseCreareRecord(generateCreareRecord(zerado, { ...config, pisCofinsCstPadrao: '99' })).pisCofinsCst).toBe('99');
    expect(() => generateCreareRecord(zerado, config)).toThrow(/CST PIS\/COFINS ausente/);
  });

  it('codigo de barras vazio usa zeros nos dois campos, como o TXT aceito pelo SIA', () => {
    const semBarras = parseCreareRecord(generateCreareRecord(bread({ codigoBarras: null, marca: null }), config));
    expect(semBarras.barcode).toBe('0'.repeat(13));
    expect(semBarras.extendedBarcode).toBe('0'.repeat(14));
    expect(semBarras.supplierManufacturer).toBe('0'.repeat(40));
    expect(semBarras.reference).toBe('0'.repeat(30));
  });

  it('TNP: EAN de 13 digitos fica no campo longo com zero a esquerda, sem deslocar o ativo', () => {
    const record = generateCreareRecord(bread({ codigoBarras: '7891242211506' }), { ...config, barcodeField: 'extended' });
    const parsed = parseCreareRecord(record);
    expect(record).toHaveLength(363);
    expect(parsed.barcode).toBe('0000000000000');
    expect(parsed.extendedBarcode).toBe('07891242211506');
    expect(record[333]).toBe('S');
  });

  it('campo longo alinha codigo curto a direita com zeros', () => {
    const longo = parseCreareRecord(generateCreareRecord(bread({ codigoBarras: '13128' }), { ...config, barcodeField: 'extended' }));
    expect(longo.barcode).toBe('0000000000000');
    expect(longo.extendedBarcode).toBe('00000000013128');
  });

  it('EAN de 14 digitos vai ao campo longo e zeros originais sao preservados', () => {
    const longo = parseCreareRecord(generateCreareRecord(bread({ codigoBarras: '17891242211503' }), config));
    expect(longo.barcode).toBe('0000000000000');
    expect(longo.extendedBarcode).toBe('17891242211503');
    const comZeroOriginal = parseCreareRecord(generateCreareRecord(bread({ codigoBarras: '07891242211506' }), config));
    expect(comZeroOriginal.extendedBarcode).toBe('07891242211506');
  });

  it('categoria em branco sai zerada, categoria sem de-para continua recusando', () => {
    // em branco e o estado de TODO produto da carga: "tudo sera completado com zeros"
    const semCategoria = bread({ fiscal: { ...bread().fiscal!, categoria: null } });
    expect(parseCreareRecord(generateCreareRecord(semCategoria, config)).categoryCode).toBe('000000000');
    // preenchida e desconhecida e alguem escrevendo nome que o Criare nao tem
    const desconhecida = bread({ fiscal: { ...bread().fiscal!, categoria: 'OUTRA' } });
    expect(() => generateCreareRecord(desconhecida, config)).toThrow(/Categoria Criare/);
  });

  it('produto criado pelo formulario da Base (sem bloco fiscal, sem custo) sai com zeros e os padroes', () => {
    /*
     * 28/09/2026: o LIMPADOR PERFUMADO CASAFLOR, cadastrado de manha pela Base,
     * nao tem linha fiscal -- o fiscal e da loja e vem pelo backfill. Recusar
     * com "Dados fiscais ausentes" deixava o produto novo fora do PDV.
     */
    const novo = bread({ grupoId: '61', fiscal: null, custo: null });
    const parsed = parseCreareRecord(generateCreareRecord(novo, {
      ...config, ecfTaxCodesByGroup: {}, ecfTaxCodePadrao: '11', pisCofinsCstPadrao: '99',
    }));
    expect(parsed.ncm).toBe('00000000');
    expect(parsed.cest).toBe('0000000');
    expect(parsed.categoryCode).toBe('000000000');
    expect(parsed.ecfTaxCode).toBe('11');
    expect(parsed.pisCofinsCst).toBe('99');
    expect(parsed.cost).toBe('0000000000');
    expect(parsed.groupCode).toBe('0061');
  });

  it('NCM vazio no bloco fiscal sai como zeros, nao como recusa', () => {
    /*
     * 28/09/2026: a regra do grupo criou o bloco fiscal do LIMPADOR sem NCM,
     * e o gerador recusava com "NCM deve conter somente digitos". NCM nao e
     * chave estrangeira no SIA: vazio vira zeros, como o resto do fiscal.
     */
    const semNcm = bread({ grupoId: '61', fiscal: { ...bread().fiscal!, ncm: null } });
    const parsed = parseCreareRecord(generateCreareRecord(semNcm, {
      ...config, ecfTaxCodesByGroup: {}, ecfTaxCodePadrao: '11', pisCofinsCstPadrao: '99',
    }));
    expect(parsed.ncm).toBe('00000000');
    expect(parsed.groupCode).toBe('0061');
  });

  it('o produto da carga (fiscal zerado) sai: zeros onde o SIA aceita, padrao da loja nas chaves', () => {
    /*
     * NCM, CEST e categoria nao sao chave estrangeira no SIA: zero passa.
     * ECF e CST PIS sao, e o importador recusa `00` -- entao vem do padrao.
     */
    const zerado = bread({
      grupoId: '65',
      fiscal: {
        ...bread().fiscal!,
        ncm: '00000000', cest: '0000000', cstPisCofins: '00', aliquotaEcfId: '00', categoria: null,
        aliquotaCheia: 0, aliquotaFcp: 0, aliquotaPis: 0, aliquotaCofins: 0, reducaoIcms: 0, icms: 0,
      },
    });
    const parsed = parseCreareRecord(generateCreareRecord(zerado, {
      ...config, ecfTaxCodesByGroup: {}, ecfTaxCodePadrao: '03', pisCofinsCstPadrao: '99',
    }));
    expect(parsed.ncm).toBe('00000000');
    expect(parsed.cest).toBe('0000000');
    expect(parsed.categoryCode).toBe('000000000');
    expect(parsed.groupCode).toBe('0065');
    expect(parsed.ecfTaxCode).toBe('03');
    expect(parsed.pisCofinsCst).toBe('99');
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

/*
 * O custo era 3 casas cravado no layout. Virou configuracao porque a evidencia
 * nao fecha: no TXT do fornecedor a SKOL 473ML, que vende a R$ 6,90, sai com
 * custo 0000000100 - R$ 0,10 a 3 casas, R$ 1,00 a 2.
 */
describe('casas decimais do custo sao configuracao, num lugar so', () => {
  it('com 3 casas, R$ 1,00 vira 0000001000', () => {
    const parsed = parseCreareRecord(
      generateCreareRecord(bread({ custo: 1 }), { ...config, decimalPlaces: { ...config.decimalPlaces, cost: 3 } }),
    );

    expect(parsed.cost).toBe('0000001000');
  });

  it('com 2 casas, R$ 1,00 vira 0000000100 — o mesmo do TXT do fornecedor', () => {
    const parsed = parseCreareRecord(
      generateCreareRecord(bread({ custo: 1 }), { ...config, decimalPlaces: { ...config.decimalPlaces, cost: 2 } }),
    );

    expect(parsed.cost).toBe('0000000100');
  });

  it('trocar as casas do custo NAO mexe em preco nem em estoque', () => {
    const comDois = parseCreareRecord(
      generateCreareRecord(bread({ custo: 1 }), { ...config, decimalPlaces: { ...config.decimalPlaces, cost: 2 } }),
    );
    const comTres = parseCreareRecord(
      generateCreareRecord(bread({ custo: 1 }), { ...config, decimalPlaces: { ...config.decimalPlaces, cost: 3 } }),
    );

    expect(comDois.unitPrice).toBe(comTres.unitPrice);
    expect(comDois.maximumQuantity).toBe(comTres.maximumQuantity);
    expect(comDois.minimumQuantity).toBe(comTres.minimumQuantity);
    expect(comDois.cost).not.toBe(comTres.cost);
  });

  it('o registro continua com 363 bytes com qualquer das duas', () => {
    for (const casas of [2, 3]) {
      const registro = generateCreareRecord(
        bread({ custo: 1 }), { ...config, decimalPlaces: { ...config.decimalPlaces, cost: casas } },
      );
      expect(registro).toHaveLength(363);
    }
  });
});

/*
 * O defeito que so a maquina da loja revelou.
 *
 * Em 16/09/2026, as 18:52, o importador do Criare na TNP recusou um arquivo de
 * dez linhas com dez erros iguais:
 *
 *     ImportarProdutos() - ERRO: '   ' is not a valid integer value
 *
 * Um erro por registro, nenhum produto lido. Eram as tres posicoes de
 * `scaleValidity`, que o layout declarava 'alpha' e o gerador preenchia com
 * '' -- tres espacos. O importador le esse campo como INTEIRO.
 *
 * O arquivo passava em todas as validacoes que existiam: 363 posicoes, ASCII
 * imprimivel, LF. Nenhuma delas perguntava se um campo NUMERICO tinha saido em
 * branco, porque nada no nosso lado se importava com isso.
 */
describe('campo numerico nunca sai em branco', () => {
  const posicoes = creareProductPositions();

  it('todo campo declarado numeric contem somente digitos', () => {
    const record = generateCreareRecord(bread(), config);
    const embranco = CREARE_PRODUCT_LAYOUT
      .filter((campo) => campo.kind === 'numeric')
      .map((campo) => {
        const p = posicoes.find((x) => x.name === campo.name)!;
        return { nome: campo.name, valor: record.slice(p.start - 1, p.end) };
      })
      .filter((x) => !/^\d+$/.test(x.valor));

    expect(embranco).toEqual([]);
  });

  /* O campo exato que quebrou, travado pelo nome para o log ficar legivel. */
  it('a validade de balanca sai 000, e nao tres espacos', () => {
    const record = generateCreareRecord(bread(), config);
    const p = posicoes.find((x) => x.name === 'scaleValidity')!;

    expect(record.slice(p.start - 1, p.end)).toBe('000');
  });

  it('vale tambem para o registro casado no SIA', () => {
    // o coditem tem de bater com o codigo interno do produto, senao o gerador
    // recusa antes de chegar no campo que este teste olha
    const record = generateCreareRecord(bread(), config, {
      coditem: '100000', codGrupo: '0011', aliqSaidaEcf: '10', ncm: '18069000',
      pesavel: 'S', teclaBalanca: '0', validadeBalanca: '0',
    });
    const p = posicoes.find((x) => x.name === 'scaleValidity')!;

    expect(record.slice(p.start - 1, p.end)).toBe('000');
  });
});
