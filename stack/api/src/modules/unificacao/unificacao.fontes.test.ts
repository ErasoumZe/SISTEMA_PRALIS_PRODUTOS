import { describe, expect, it } from 'vitest';
import {
  barrasAmbiguas,
  chaveDeBarras,
  comCabecalho,
  lerFonte,
  limparProtecao,
  normalizarNome,
  paraAtivo,
  paraNumero,
  parseCsv,
  type LinhaFonte,
} from './unificacao.fontes';

describe('parser de CSV', () => {
  it('respeita campo entre aspas com o separador dentro', () => {
    const t = parseCsv('A;B\n1;"tem ; dentro"');

    expect(t[1]).toEqual(['1', 'tem ; dentro']);
  });

  /*
   * O caso real da fonte do SIA: o CST vem protegido pelo Excel como ="040",
   * e o CSV embrulha isso em aspas dobrando as internas. split(';') devolveria
   * lixo e o CST entraria no banco sem casar com nada.
   */
  it('desembrulha o CST protegido pelo Excel', () => {
    const linha = '10000;00000000010000;ABACAXI UNID;A;3;"=""040""";102;;0;18';
    const campos = parseCsv('CODITEM;COD_BARRAS;NOME;ATIVO;ALIQ_ECF;CST;CSOSN;NCM;REDUCAO;ALIQ_INTERNA\n' + linha)[1]!;

    expect(campos[5]).toBe('="040"');
    expect(limparProtecao(campos[5])).toBe('040');
  });

  it('ignora BOM e aceita CRLF', () => {
    const t = parseCsv('﻿A;B\r\n1;2\r\n');

    expect(t).toEqual([['A', 'B'], ['1', '2']]);
  });

  it('descarta linha totalmente vazia, mas mantem campo vazio no meio', () => {
    const t = parseCsv('A;B;C\n1;;3\n\n');

    expect(t).toHaveLength(2);
    expect(t[1]).toEqual(['1', '', '3']);
  });

  it('comCabecalho casa valor com coluna mesmo faltando campo no fim', () => {
    const linhas = comCabecalho(parseCsv('A;B;C\n1;2'));

    expect(linhas[0]).toEqual({ A: '1', B: '2', C: '' });
  });
});

describe('limpezas — so o que atrapalha a leitura', () => {
  it('chave de barras tira pontuacao e zero a esquerda', () => {
    expect(chaveDeBarras('00000000010000')).toBe('10000');
    expect(chaveDeBarras('7891149100828')).toBe('7891149100828');
    expect(chaveDeBarras('')).toBe('');
  });

  it('numero aceita virgula decimal e recusa lixo', () => {
    expect(paraNumero('3,69')).toBe(3.69);
    expect(paraNumero('0.1')).toBe(0.1);
    expect(paraNumero('')).toBeNull();
    expect(paraNumero('n/a')).toBeNull();
  });

  it('ativo entende os tres jeitos que as fontes escrevem', () => {
    expect(paraAtivo('A')).toBe(true);
    expect(paraAtivo('I')).toBe(false);
    expect(paraAtivo('Sim')).toBe(true);
    expect(paraAtivo('Não')).toBe(false);
    expect(paraAtivo('SIM')).toBe(true);
    expect(paraAtivo('NÃO')).toBe(false);
  });

  it('ativo vazio e NULO, nao falso — "nao sei" nao e "inativo"', () => {
    expect(paraAtivo('')).toBeNull();
    expect(paraAtivo(undefined)).toBeNull();
  });
});

describe('nome normalizado — chave FRACA', () => {
  it('tira acento, pontuacao e caixa', () => {
    expect(normalizarNome('Açúcar Cristal 5kg')).toBe('ACUCAR CRISTAL 5KG');
  });

  it('tira o caractere invisivel que veio da planilha', () => {
    // U+2060 aparece em 11 dos 13 grupos do cadastro; sem tirar, nada casa
    expect(normalizarNome('MER⁠ BEBIDAS')).toBe('MER BEBIDAS');
  });

  /*
   * NAO remove unidade nem quantidade de proposito: apagar isso fundiria
   * produtos diferentes, que e exatamente a invencao que nao pode acontecer.
   */
  it('NAO funde produtos que so diferem na quantidade', () => {
    expect(normalizarNome('COCA COLA 1L')).not.toBe(normalizarNome('COCA COLA 2L'));
    expect(normalizarNome('ABACAXI UNID')).not.toBe(normalizarNome('ABACAXI KG'));
  });
});

describe('mapeamento por fonte', () => {
  it('SIA traz o fiscal da Lisboa e nada de custo', () => {
    const csv = 'CODITEM;COD_BARRAS;NOME;ATIVO;ALIQ_ECF;CST;CSOSN;NCM;REDUCAO;ALIQ_INTERNA\n'
      + '10000;00000000010000;ABACAXI UNID;A;3;"=""040""";102;08043000;0;18';

    expect(lerFonte('sia_li', csv)[0]).toMatchObject({
      fonte: 'sia_li',
      codInterno: '10000',
      chaveBarras: '10000',
      nome: 'ABACAXI UNID',
      ativo: true,
      aliqEcf: '3',
      cst: '040',
      csosn: '102',
      ncm: '08043000',
      custo: null,
    });
  });

  it('Compilart traz custo e venda e nada de fiscal', () => {
    const csv = 'COD_INTERNO;COD_BARRAS;NOME;CUSTO;VENDA;ATIVO\n'
      + '4396;00000000013121;FOLHADO;0,1;3,9;Sim';

    expect(lerFonte('compilart_tnp', csv)[0]).toMatchObject({
      fonte: 'compilart_tnp', custo: 0.1, venda: 3.9, ativo: true, ncm: null,
    });
  });

  it('planilha antiga nao tem barras — a chave sai vazia, nao inventada', () => {
    const linha = lerFonte('planilha_tnp', 'COD_INTERNO;NOME;ATIVO\n10000;ABACAXI UNID;SIM')[0]!;

    expect(linha.chaveBarras).toBe('');
    expect(linha.codInterno).toBe('10000');
  });

  it('fiscal da contabilidade traz ICMS com virgula', () => {
    const linha = lerFonte('fiscal_tnp', 'COD_INTERNO;NCM;CST;ICMS_EFETIVO\n10010;17019900;6;3,69')[0]!;

    expect(linha).toMatchObject({ ncm: '17019900', cst: '6', icmsEfetivo: 3.69, ativo: null });
  });
});

describe('codigo de barras ambiguo dentro da mesma fonte', () => {
  const linha = (chaveBarras: string, nome: string) => ({ chaveBarras, nome }) as LinhaFonte;

  it('acusa quando o mesmo codigo cobre produtos diferentes', () => {
    const achados = barrasAmbiguas([
      linha('7891098040909', 'ICE TEA LEAO LIMÃO 1500ML'),
      linha('7891098040909', 'ICE TEA LEAO PESSEGO 1500ML'),
    ]);

    expect(achados).toHaveLength(1);
    expect(achados[0]!.chave).toBe('7891098040909');
  });

  it('nao acusa quando e a mesma coisa escrita diferente', () => {
    expect(barrasAmbiguas([
      linha('789', 'AÇÚCAR CRISTAL'),
      linha('789', 'Acucar  Cristal'),
    ])).toEqual([]);
  });

  it('linha sem barras nunca vira ambiguidade', () => {
    expect(barrasAmbiguas([linha('', 'A'), linha('', 'B')])).toEqual([]);
  });
});
