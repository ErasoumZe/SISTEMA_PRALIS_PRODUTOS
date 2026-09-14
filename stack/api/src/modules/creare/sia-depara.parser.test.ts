import { describe, expect, it } from 'vitest';
import { chaveDeBarras, lerDePara, mapearColunas } from './sia-depara.parser';

/**
 * Cabeçalho reduzido — a exportação real tem 340 colunas, e o parser precisa
 * achar as 10 que interessam por NOME, não por posição.
 */
const cabecalho = [
  'Curva ABC Valor', 'Cód. produto', 'Cód. barras', 'Descrição', 'Cód. grupo',
  'Alíq. Saída', '% Redução', 'Alíq. interna', 'CST Saída', 'CSOSN_EMPRESA', 'NCM', 'Ativo',
];

const linha = (
  coditem: string,
  barras: string,
  extras: Partial<{ desc: string; grupo: string; ecf: string; reducao: string }> = {},
) => [
  'A', coditem, barras, extras.desc ?? 'PRODUTO', extras.grupo ?? '0005',
  extras.ecf ?? '3', extras.reducao ?? '0', '18', '000', '101', '19059090', 'S',
];

describe('chave de casamento por codigo de barras', () => {
  it('tira pontuacao e zeros a esquerda, como o resto do sistema', () => {
    expect(chaveDeBarras('00000000010000')).toBe('10000');
    expect(chaveDeBarras('7891149100828')).toBe('7891149100828');
    expect(chaveDeBarras('789.114-910/0828')).toBe('7891149100828');
  });

  it('devolve vazio quando nao ha digito nenhum', () => {
    expect(chaveDeBarras('')).toBe('');
    expect(chaveDeBarras(null)).toBe('');
    expect(chaveDeBarras('SEM CODIGO')).toBe('');
  });

  it('nao transforma um zero legitimo em vazio', () => {
    expect(chaveDeBarras('0000')).toBe('0');
  });
});

describe('mapeamento das colunas do SIA', () => {
  it('acha as colunas ignorando acento, caixa e pontuacao', () => {
    const indices = mapearColunas(cabecalho);

    expect(indices.coditem).toBe(1);
    expect(indices.codigoBarras).toBe(2);
    expect(indices.aliqSaidaEcf).toBe(5);
  });

  it('acha as colunas mesmo fora de ordem', () => {
    const trocado = [...cabecalho].reverse();

    expect(mapearColunas(trocado).coditem).toBe(trocado.indexOf('Cód. produto'));
  });

  it('diz QUAIS colunas faltaram, em vez de falhar depois com dado torto', () => {
    expect(() => mapearColunas(['Cód. produto', 'Descrição']))
      .toThrow(/codigoBarras/);
  });
});

describe('mapeamento do CSV normalizado', () => {
  it('aceita os cabeçalhos do fonte_sia_lisboa.csv', () => {
    const normalizado = [
      'CODITEM', 'COD_BARRAS', 'NOME', 'ATIVO', 'ALIQ_ECF',
      'CST', 'CSOSN', 'NCM', 'REDUCAO', 'ALIQ_INTERNA', 'GRUPO',
    ];

    expect(mapearColunas(normalizado)).toMatchObject({
      coditem: 0,
      codigoBarras: 1,
      descricao: 2,
      ativo: 3,
      aliqSaidaEcf: 4,
      cstSaida: 5,
      csosn: 6,
      ncm: 7,
      reducao: 8,
      aliquotaInterna: 9,
      codGrupo: 10,
    });
  });
});

describe('leitura do de-para', () => {
  it('normaliza a chave e preserva o codigo de barras original', () => {
    const r = lerDePara([cabecalho, linha('10000', '00000000010000')]);

    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({
      coditem: '10000',
      codigoBarras: '00000000010000',
      chaveBarras: '10000',
      aliqSaidaEcf: '3',
    });
  });

  it('conta as linhas sem codigo de barras em vez de somir com elas', () => {
    const r = lerDePara([cabecalho, linha('10000', ''), linha('10001', '789')]);

    expect(r.semBarras).toBe(1);
    expect(r.linhas).toHaveLength(1);
  });

  /*
   * O caso perigoso: dois produtos do SIA com o mesmo codigo de barras. Casar
   * por barras escolheria um dos dois no chute, e o importador zera o codbarra
   * do outro antes de gravar — o produto sumiria do caixa.
   */
  it('acusa codigo de barras que aponta para mais de um produto', () => {
    const r = lerDePara([cabecalho, linha('10000', '7891'), linha('10001', '0007891')]);

    expect(r.barrasAmbiguas).toEqual([{ chave: '7891', coditens: ['10000', '10001'] }]);
  });

  it('acusa coditem repetido', () => {
    const r = lerDePara([cabecalho, linha('10000', '111'), linha('10000', '222')]);

    expect(r.coditensRepetidos).toEqual(['10000']);
  });

  it('nao acusa nada quando a exportacao esta sa', () => {
    const r = lerDePara([cabecalho, linha('10000', '111'), linha('10001', '222')]);

    expect(r.barrasAmbiguas).toEqual([]);
    expect(r.coditensRepetidos).toEqual([]);
    expect(r.linhas).toHaveLength(2);
  });

  it('aceita reducao com virgula e descarta texto', () => {
    const comVirgula = lerDePara([cabecalho, linha('1', '111', { reducao: '53,33' })]);
    const comLixo = lerDePara([cabecalho, linha('2', '222', { reducao: 'n/a' })]);

    expect(comVirgula.linhas[0]!.reducao).toBe('53.33');
    expect(comLixo.linhas[0]!.reducao).toBeNull();
  });

  it('pula linha sem coditem — rodape e linha em branco nao viram produto', () => {
    const r = lerDePara([cabecalho, linha('', '111'), linha('10001', '222')]);

    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]!.coditem).toBe('10001');
  });
});
