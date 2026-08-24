import { describe, it, expect } from 'vitest';
import type { ProductSchemas } from '@pralis/shared';
import {
  mapProductToCells, inputColumnsFor, DEFAULT_FOOTER_COLUMNS, DIAS_COLS, DIA_LABELS,
  simNao, formatQuantidade, barcodeCell, descontoParaAZ,
  type SheetCell,
} from './product-sheet.mapper';

type Product = ProductSchemas.ProductEntity;

const OPTS = { defaultLojas: 'TNP,LI,HORA' };

/** Produto de revenda completo — serve de base para os cenários. */
function produto(over: Partial<Product> = {}): Product {
  return {
    id: '0197d7c4-2c9a-7000-8000-000000000001',
    codigo: 'PR-AB12-CD34',
    loja: 'BASE',
    baseProductId: null,
    createdByName: 'Rodrigo',
    createdAt: '2026-08-18T12:00:00.000Z',
    nome: 'SNICKERS',
    quantidade: 45,
    medidaBase: 'G',
    codigoBarras: '7896423420180',
    marca: 'MARS',
    embalagem: 'CX',
    cDe: 'C/',
    qtCad: 20,
    medidaCompra: 'UN',
    codigoInterno: '00007',
    fotoUrl: 'https://res.cloudinary.com/demo/snickers.jpg',
    grupo: 'MER BOMBONIERI - CHOCOLATES',
    tipo: 'revenda',
    status: 'ativo',
    habilitarAjuda: true,
    estoqueMin: 20,
    estoqueMax: 100,
    setorEstoque: 'LJ - CAIXAS',
    custo: 84.9,
    margemPontual: 0.7,
    vVendaPontual: 6.5,
    auto: true,
    localVenda1: 'CAIXA C/3 LADOS "U" 3P',
    localVenda2: null,
    promocoes: [],
    transformacao: null,
    fiscal: null,
    ...over,
  } as Product;
}

const valor = (c: SheetCell | undefined) => (c && c.kind !== 'empty' ? c.value : null);
const vazia = (c: SheetCell | undefined) => !!c && c.kind === 'empty';

describe('mapper: colunas do cadastro geral', () => {
  it('mapeia todas as colunas de entrada (nenhuma coluna some do mapa)', () => {
    const cells = mapProductToCells(produto(), OPTS);
    for (const col of inputColumnsFor(DEFAULT_FOOTER_COLUMNS)) {
      expect(cells[col], `coluna ${col} ausente no mapa`).toBeDefined();
    }
    // e não escreve NADA fora das colunas de entrada (as calculadas ficam intactas)
    expect(Object.keys(cells).sort()).toEqual(inputColumnsFor(DEFAULT_FOOTER_COLUMNS).sort());
  });

  it('mapeia identidade, embalagem e preço nas colunas certas', () => {
    const c = mapProductToCells(produto(), OPTS);
    expect(valor(c.C)).toBe('ATIVO');
    expect(valor(c.D)).toBe('TNP,LI,HORA');
    expect(valor(c.E)).toBe('SNICKERS');
    expect(valor(c.F)).toBe('45,000'); // coluna TEXTO em pt-BR com 3 casas
    expect(valor(c.G)).toBe('G');
    expect(valor(c.J)).toBe(7896423420180);
    expect(valor(c.K)).toBe('MARS');
    expect(valor(c.L)).toBe('CX');
    expect(valor(c.M)).toBe('C/');
    expect(valor(c.N)).toBe(20);
    expect(valor(c.O)).toBe('UN');
    expect(valor(c.P)).toBe('1 CX C/ (SNICKERS 45 G)');
    expect(valor(c.AC)).toBe('00007');
    expect(valor(c.AE)).toBe(20);
    expect(valor(c.AG)).toBe(100);
    expect(valor(c.AI)).toBe('LJ - CAIXAS');
    expect(valor(c.AJ)).toBe(84.9);
    expect(valor(c.AM)).toBe(6.5);
    expect(valor(c.AQ)).toBe('CAIXA C/3 LADOS "U" 3P');
    expect(vazia(c.AS)).toBe(true);
    expect(valor(c.CO)).toBe('https://res.cloudinary.com/demo/snickers.jpg');
    expect(valor(c.CP)).toBe('0197d7c4-2c9a-7000-8000-000000000001');
  });

  it('margem vai como FRAÇÃO (coluna AL tem formato 0%)', () => {
    const c = mapProductToCells(produto({ margemPontual: 0.7 }), OPTS);
    expect(c.AL).toEqual({ kind: 'number', value: 0.7 });
  });

  it('status inativo vira INATIVO', () => {
    const c = mapProductToCells(produto({ status: 'inativo' }), OPTS);
    expect(valor(c.C)).toBe('INATIVO');
  });

  it('quantidade sempre com 3 casas e vírgula', () => {
    expect(formatQuantidade(25)).toBe('25,000');
    expect(formatQuantidade(0)).toBe('0,000');
    expect(formatQuantidade(1.5)).toBe('1,500');
    expect(formatQuantidade(1234.5)).toBe('1234,500'); // sem separador de milhar
  });
});

describe('mapper: conversão SIM/NÃO', () => {
  it('converte booleanos na convenção da planilha', () => {
    expect(simNao(true)).toBe('SIM');
    expect(simNao(false)).toBe('NÃO');
  });

  it('AN (auto) e CN (habilitar ajuda) usam SIM/NÃO', () => {
    const sim = mapProductToCells(produto({ auto: true, habilitarAjuda: true }), OPTS);
    expect(valor(sim.AN)).toBe('SIM');
    expect(valor(sim.CN)).toBe('SIM');

    const nao = mapProductToCells(produto({ auto: false, habilitarAjuda: false }), OPTS);
    expect(valor(nao.AN)).toBe('NÃO');
    expect(valor(nao.CN)).toBe('NÃO');
  });
});

describe('mapper: revenda x transformação', () => {
  it('revenda põe o grupo em R e deixa T e o bloco de transformação vazios', () => {
    const c = mapProductToCells(produto(), OPTS);
    expect(valor(c.R)).toBe('MER BOMBONIERI - CHOCOLATES');
    expect(vazia(c.T)).toBe(true);
    for (const col of ['V', 'W', 'X', 'Y', 'Z']) expect(vazia(c[col])).toBe(true);
  });

  it('transformação põe o grupo em T, preenche V:Z e deixa R vazio', () => {
    const c = mapProductToCells(
      produto({
        tipo: 'transformacao',
        grupo: 'MER MAT. PRIMA - FARINHAS',
        transformacao: {
          precisao: 'EXATOS',
          qtd: 25000,
          unidade: 'G',
          produtoReceituario: 'FARINHA DE TRIGO EXTRA CLARA (000)',
          refReceituario: 'REF-1',
        },
      }),
      OPTS,
    );
    expect(vazia(c.R)).toBe(true);
    expect(valor(c.T)).toBe('MER MAT. PRIMA - FARINHAS');
    expect(valor(c.V)).toBe('EXATOS');
    expect(valor(c.W)).toBe(25000);
    expect(valor(c.X)).toBe('G');
    expect(valor(c.Y)).toBe('FARINHA DE TRIGO EXTRA CLARA (000)');
    expect(valor(c.Z)).toBe('REF-1');
  });
});

describe('mapper: fiscal', () => {
  it('mapeia o bloco fiscal completo', () => {
    const c = mapProductToCells(
      produto({
        fiscal: {
          ncm: '19059090',
          cest: '1704000',
          categoria: 'PADARIA',
          cstPisCofins: '01',
          aliquotaCheia: 7,
          aliquotaFcp: 2,
          aliquotaPis: 1.65,
          aliquotaCofins: 7.6,
          reducaoIcms: 33.33,
          icms: 7,
        },
      }),
      OPTS,
    );
    expect(valor(c.BS)).toBe(33.33);
    expect(valor(c.BT)).toBe(7);
    expect(valor(c.BU)).toBe(2);
    expect(valor(c.BV)).toBe('01');
    expect(valor(c.BW)).toBe(1.65);
    expect(valor(c.BX)).toBe(7.6);
    expect(valor(c.CA)).toBe('19059090');
    expect(valor(c.CB)).toBe('PADARIA');
    expect(valor(c.CD)).toBe(7);
    expect(valor(c.CE)).toBe('1704000');
  });

  it('CST, NCM e CEST são TEXTO — zero à esquerda não some', () => {
    const c = mapProductToCells(
      produto({
        fiscal: {
          ncm: '01012100', cest: '0100100', categoria: null, cstPisCofins: '01',
          aliquotaCheia: null, aliquotaFcp: null, aliquotaPis: null,
          aliquotaCofins: null, reducaoIcms: null, icms: null,
        },
      }),
      OPTS,
    );
    expect(c.CA).toEqual({ kind: 'text', value: '01012100' });
    expect(c.CE).toEqual({ kind: 'text', value: '0100100' });
    expect(c.BV).toEqual({ kind: 'text', value: '01' });
  });

  it('sem fiscal, todas as colunas fiscais ficam vazias', () => {
    const c = mapProductToCells(produto({ fiscal: null }), OPTS);
    for (const col of ['BS', 'BT', 'BU', 'BV', 'BW', 'BX', 'CA', 'CB', 'CD', 'CE']) {
      expect(vazia(c[col]), `coluna ${col} deveria estar vazia`).toBe(true);
    }
  });
});

describe('mapper: promoção', () => {
  const dias = [true, true, true, true, true, false, false];

  it('promoção por DESCONTO grava AZ como fração NEGATIVA e deixa AW vazio', () => {
    const c = mapProductToCells(
      produto({
        promocoes: [{
          tipo: 'desconto', valor: null, descontoPct: 0.2,
          horaInicio: '12:00', horaFim: '15:00', dias, descontoAte: null,
        }],
      }),
      OPTS,
    );
    expect(vazia(c.AW)).toBe(true);
    // AY = (AZ*AO)+AO -> só resulta em 0,8×AO se AZ for -0,20
    expect(c.AZ).toEqual({ kind: 'number', value: -0.2 });
    expect(c.BL).toEqual({ kind: 'entered', value: '12:00' });
    expect(c.BO).toEqual({ kind: 'entered', value: '15:00' });
  });

  it('o desconto gravado reproduz o preço promocional da fórmula AY', () => {
    const precoNormal = 10; // AO
    for (const pct of [0.05, 0.1, 0.2, 0.35, 0.5]) {
      const c = mapProductToCells(
        produto({
          promocoes: [{
            tipo: 'desconto', valor: null, descontoPct: pct,
            horaInicio: null, horaFim: null, dias, descontoAte: null,
          }],
        }),
        OPTS,
      );
      const az = (c.AZ as { value: number }).value;
      const ay = az * precoNormal + precoNormal; // fórmula real da coluna AY
      expect(ay).toBeCloseTo(precoNormal * (1 - pct), 10);
      expect(az).toBeLessThan(0);
    }
  });

  it('descontoParaAZ normaliza o sinal e preserva o zero', () => {
    expect(descontoParaAZ(0.2)).toBe(-0.2);
    expect(descontoParaAZ(-0.2)).toBe(-0.2); // já negativo continua negativo
    expect(descontoParaAZ(0)).toBe(0); // e não -0
    expect(Object.is(descontoParaAZ(0), -0)).toBe(false);
  });

  it('promoção por VALOR grava AW e deixa AZ vazio', () => {
    const c = mapProductToCells(
      produto({
        promocoes: [{
          tipo: 'valor', valor: 4.99, descontoPct: null,
          horaInicio: null, horaFim: null, dias, descontoAte: null,
        }],
      }),
      OPTS,
    );
    expect(c.AW).toEqual({ kind: 'number', value: 4.99 });
    expect(vazia(c.AZ)).toBe(true);
  });

  it('dia ATIVO grava o RÓTULO do dia; dia inativo fica VAZIO (nunca SIM/NÃO)', () => {
    const c = mapProductToCells(
      produto({
        promocoes: [{
          tipo: 'desconto', valor: null, descontoPct: 0.1,
          horaInicio: null, horaFim: null,
          dias: [true, false, false, false, false, false, true], // SEG e DOM
          descontoAte: null,
        }],
      }),
      OPTS,
    );
    expect(DIAS_COLS.map((col) => valor(c[col]))).toEqual([
      'SEG', null, null, null, null, null, 'DOM',
    ]);
    // o HLOOKUP da coluna AP procura o rótulo do dia; SIM/NÃO nunca casaria
    for (const col of DIAS_COLS) {
      expect(['SIM', 'NÃO']).not.toContain(valor(c[col]));
    }
  });

  it('cobre os SETE dias, um a um, na coluna certa', () => {
    expect(DIAS_COLS).toEqual(['BB', 'BC', 'BD', 'BE', 'BF', 'BG', 'BH']);
    expect(DIA_LABELS).toEqual(['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']);

    DIA_LABELS.forEach((label, i) => {
      const dias = [false, false, false, false, false, false, false];
      dias[i] = true;
      const c = mapProductToCells(
        produto({
          promocoes: [{
            tipo: 'desconto', valor: null, descontoPct: 0.1,
            horaInicio: null, horaFim: null, dias, descontoAte: null,
          }],
        }),
        OPTS,
      );
      // só a coluna do dia ativo tem valor, e o valor é o próprio rótulo
      DIAS_COLS.forEach((col, j) => {
        if (i === j) expect(valor(c[col]), `${col} deveria ser ${label}`).toBe(label);
        else expect(vazia(c[col]), `${col} deveria estar vazia`).toBe(true);
      });
    });
  });

  it('todos os sete dias ativos preenchem BB:BH inteiro', () => {
    const c = mapProductToCells(
      produto({
        promocoes: [{
          tipo: 'desconto', valor: null, descontoPct: 0.1,
          horaInicio: null, horaFim: null,
          dias: [true, true, true, true, true, true, true],
          descontoAte: null,
        }],
      }),
      OPTS,
    );
    expect(DIAS_COLS.map((col) => valor(c[col]))).toEqual([...DIA_LABELS]);
  });

  it('sem promoção, o bloco inteiro (AW, AZ, BA, BB:BH, BL, BO) fica vazio', () => {
    const c = mapProductToCells(produto({ promocoes: [] }), OPTS);
    for (const col of ['AW', 'AZ', 'BA', ...DIAS_COLS, 'BL', 'BO']) {
      expect(vazia(c[col]), `coluna ${col} deveria estar vazia`).toBe(true);
    }
    expect(valor(c.AU)).toBe('NÃO'); // flag da promoção acompanha
  });

  it('AU sinaliza SIM quando existe promoção', () => {
    const c = mapProductToCells(
      produto({
        promocoes: [{
          tipo: 'valor', valor: 3, descontoPct: null,
          horaInicio: null, horaFim: null, dias, descontoAte: null,
        }],
      }),
      OPTS,
    );
    expect(valor(c.AU)).toBe('SIM');
  });

  it('usa a PRIMEIRA promoção quando o produto tem mais de uma', () => {
    // a planilha tem um único bloco de promoção por linha
    const c = mapProductToCells(
      produto({
        promocoes: [
          {
            tipo: 'valor', valor: 4.99, descontoPct: null,
            horaInicio: '08:00', horaFim: '10:00',
            dias: [true, false, false, false, false, false, false],
            descontoAte: null,
          },
          {
            tipo: 'desconto', valor: null, descontoPct: 0.5,
            horaInicio: '20:00', horaFim: '22:00',
            dias: [false, false, false, false, false, false, true],
            descontoAte: 'ATÉ 50%',
          },
        ],
      }),
      OPTS,
    );
    expect(c.AW).toEqual({ kind: 'number', value: 4.99 }); // da primeira
    expect(vazia(c.AZ)).toBe(true); // a segunda foi ignorada
    expect(valor(c.BL)).toBe('08:00');
    expect(valor(c.BB)).toBe('SEG');
    expect(vazia(c.BH)).toBe(true);
    expect(vazia(c.BA)).toBe(true);
  });

  it('BA vai como TEXTO, no rótulo aceito pela validação da coluna', () => {
    const c = mapProductToCells(
      produto({
        promocoes: [{
          tipo: 'desconto', valor: null, descontoPct: 0.2,
          horaInicio: null, horaFim: null, dias, descontoAte: 'ATÉ 20%',
        }],
      }),
      OPTS,
    );
    // a lista DESCONTOATE aceita "ATÉ 5%".."ATÉ 50%" — é rótulo, não número
    expect(c.BA).toEqual({ kind: 'text', value: 'ATÉ 20%' });
  });
});

describe('mapper: colunas operacionais da planilha', () => {
  it('revenda marca Q=SIM e S=NÃO', () => {
    const c = mapProductToCells(produto({ tipo: 'revenda' }), OPTS);
    expect(valor(c.Q)).toBe('SIM');
    expect(valor(c.S)).toBe('NÃO');
  });

  it('transformação marca Q=NÃO e S=SIM (a coluna U depende de S)', () => {
    const c = mapProductToCells(
      produto({
        tipo: 'transformacao',
        transformacao: {
          precisao: 'EXATOS', qtd: 1000, unidade: 'G',
          produtoReceituario: null, refReceituario: null,
        },
      }),
      OPTS,
    );
    expect(valor(c.Q)).toBe('NÃO');
    expect(valor(c.S)).toBe('SIM');
  });

  it('Q e S são SEMPRE complementares — nunca combinação incoerente', () => {
    for (const tipo of ['revenda', 'transformacao'] as const) {
      const c = mapProductToCells(
        produto({
          tipo,
          transformacao: tipo === 'transformacao'
            ? { precisao: 'EXATOS', qtd: 1, unidade: 'G', produtoReceituario: null, refReceituario: null }
            : null,
        }),
        OPTS,
      );
      const q = valor(c.Q);
      const s = valor(c.S);
      expect([q, s]).not.toEqual(['SIM', 'SIM']);
      expect([q, s]).not.toEqual(['NÃO', 'NÃO']);
      expect(q === 'SIM' ? s : q).toBe('NÃO');
    }
  });

  it('AB espelha o status (a coluna AD só mostra a descrição se AB estiver preenchida)', () => {
    expect(valor(mapProductToCells(produto({ status: 'ativo' }), OPTS).AB)).toBe('ATIVO');
    expect(valor(mapProductToCells(produto({ status: 'inativo' }), OPTS).AB)).toBe('INATIVO');
    // AB acompanha C
    const c = mapProductToCells(produto({ status: 'inativo' }), OPTS);
    expect(valor(c.AB)).toBe(valor(c.C));
  });

  it('rótulos fixos: BK, BM e BP', () => {
    const c = mapProductToCells(produto(), OPTS);
    expect(valor(c.BK)).toBe('DE:');
    expect(valor(c.BM)).toBe('ATÉ:');
    expect(valor(c.BP)).toBe('NÃO REVISADO');
  });

  it('as colunas operacionais nunca ficam vazias, mesmo no produto mínimo', () => {
    const c = mapProductToCells(
      produto({
        marca: null, grupo: null, codigoBarras: null, promocoes: [],
        custo: null, margemPontual: null, fiscal: null,
      }),
      OPTS,
    );
    for (const col of ['Q', 'S', 'AB', 'AU', 'BK', 'BM', 'BP']) {
      expect(vazia(c[col]), `coluna ${col} não deveria estar vazia`).toBe(false);
    }
  });
});

describe('mapper: campos ausentes viram célula vazia', () => {
  it('produto mínimo limpa tudo que não tem valor', () => {
    const c = mapProductToCells(
      produto({
        codigoBarras: null, marca: null, embalagem: null, cDe: null, medidaCompra: null,
        codigoInterno: null, fotoUrl: null, grupo: null, setorEstoque: null,
        estoqueMin: null, estoqueMax: null, custo: null, margemPontual: null,
        vVendaPontual: null, localVenda1: null, localVenda2: null,
      }),
      OPTS,
    );
    const devemEstarVazias = [
      'J', 'K', 'L', 'M', 'O', 'R', 'T', 'AC', 'AE', 'AG', 'AI', 'AJ', 'AL', 'AM', 'AQ', 'AS', 'CO',
    ];
    for (const col of devemEstarVazias) {
      expect(vazia(c[col]), `coluna ${col} deveria estar vazia`).toBe(true);
    }
    // o que nunca fica vazio
    expect(valor(c.E)).toBe('SNICKERS');
    expect(valor(c.CP)).toBe('0197d7c4-2c9a-7000-8000-000000000001');
    expect(valor(c.F)).toBe('45,000');
  });

  it('string em branco também vira célula vazia (não grava " ")', () => {
    const c = mapProductToCells(produto({ marca: '   ' }), OPTS);
    expect(vazia(c.K)).toBe(true);
  });
});

describe('mapper: código de barras', () => {
  it('preserva zero à esquerda gravando como TEXTO', () => {
    expect(barcodeCell('07891080001048')).toEqual({ kind: 'text', value: '07891080001048' });
    expect(barcodeCell('0000123')).toEqual({ kind: 'text', value: '0000123' });
  });

  it('EAN comum continua NÚMERO (compatível com o que já existe na planilha)', () => {
    expect(barcodeCell('7896423420180')).toEqual({ kind: 'number', value: 7896423420180 });
  });

  it('código com letras/traços fica TEXTO', () => {
    expect(barcodeCell('ABC-123')).toEqual({ kind: 'text', value: 'ABC-123' });
  });

  it('número grande demais para inteiro exato vira TEXTO', () => {
    expect(barcodeCell('12345678901234567890')).toEqual({ kind: 'text', value: '12345678901234567890' });
  });

  it('vazio/nulo limpa a célula', () => {
    expect(barcodeCell(null)).toEqual({ kind: 'empty' });
    expect(barcodeCell('')).toEqual({ kind: 'empty' });
    expect(barcodeCell('  ')).toEqual({ kind: 'empty' });
  });

  it('"0" sozinho continua número (não é zero à esquerda)', () => {
    expect(barcodeCell('0')).toEqual({ kind: 'number', value: 0 });
  });
});
