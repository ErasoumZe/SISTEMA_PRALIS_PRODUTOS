import { describe, expect, it } from 'vitest';
import {
  cabecalhosPorColuna,
  colunasPorCabecalho,
  conferirAbaDeDestino,
  normalizarCabecalho,
  traduzirCelulas,
  faixasDaAba,
  colunaNaFaixa,
} from './sheet-traducao';
import type { CellMap } from './product-sheet.mapper';

const letra = (i: number) => (i < 26
  ? String.fromCharCode(65 + i)
  : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

const texto = (v: string) => ({ kind: 'text' as const, value: v });

describe('normalizacao de cabecalho', () => {
  /* Os nomes da planilha carregam U+2060 invisivel — sem tirar, nada casa. */
  it('tira caractere invisivel, espaco duplo e caixa', () => {
    expect(normalizarCabecalho('  Codigo⁠  Barras ')).toBe('CODIGO BARRAS');
    expect(normalizarCabecalho('nome')).toBe('NOME');
  });

  it('celula vazia nao vira cabecalho', () => {
    expect(normalizarCabecalho('')).toBe('');
    expect(normalizarCabecalho('   ')).toBe('');
    expect(normalizarCabecalho(null)).toBe('');
  });
});

describe('leitura da linha de cabecalho', () => {
  it('pula as colunas sem cabecalho', () => {
    const linha = ['A/I', '', 'NOME', '', 'CUSTO'];

    expect([...cabecalhosPorColuna(linha, letra)]).toEqual([['A', 'A/I'], ['C', 'NOME'], ['E', 'CUSTO']]);
    expect([...colunasPorCabecalho(linha, letra)]).toEqual([['A/I', 'A'], ['NOME', 'C'], ['CUSTO', 'E']]);
  });

  /* Escrever nas duas duplicaria o valor; a primeira e a que as formulas usam. */
  it('cabecalho repetido fica com a PRIMEIRA coluna', () => {
    expect(colunasPorCabecalho(['QT', 'NOME', 'QT'], letra).get('QT')).toBe('A');
  });
});

describe('traducao entre abas', () => {
  /*
   * O caso real: das 62 colunas em comum entre a BASE e a aba TNP, 61 estao em
   * posicao diferente. Casar por posicao gravaria custo na coluna de aliquota.
   */
  const origem = cabecalhosPorColuna(['A/I', 'LOJAS', 'NOME', 'CUSTO'], letra); // A B C D
  const destino = colunasPorCabecalho(['A/I', 'CUSTO', '', 'NOME'], letra); //     A B _ D

  it('leva cada valor para a coluna do MESMO cabecalho, nao da mesma posicao', () => {
    const celulas: CellMap = { A: texto('ATIVO'), C: texto('ARROZ'), D: texto('9,90') };

    const r = traduzirCelulas(celulas, origem, destino);

    expect(r.celulas).toEqual({ A: texto('ATIVO'), D: texto('ARROZ'), B: texto('9,90') });
  });

  it('o que o destino nao tem NAO e escrito — e fica listado', () => {
    const celulas: CellMap = { B: texto('TNP,LI'), C: texto('ARROZ') };

    const r = traduzirCelulas(celulas, origem, destino);

    expect(r.celulas).toEqual({ D: texto('ARROZ') });
    expect(r.semCorrespondencia).toEqual(['LOJAS']);
  });

  it('coluna da origem SEM cabecalho fica de fora, e e reportada', () => {
    const comAuxiliar = cabecalhosPorColuna(['A/I', '', 'NOME'], letra);
    const celulas: CellMap = { A: texto('ATIVO'), B: texto('flag'), C: texto('ARROZ') };

    const r = traduzirCelulas(celulas, comAuxiliar, destino);

    expect(r.semCabecalho).toEqual(['B']);
    expect(r.celulas.B).toBeUndefined();
  });

  it('aba que ganhar a coluna depois passa a receber, sem mexer em codigo', () => {
    const celulas: CellMap = { B: texto('TNP,LI') };
    const destinoNovo = colunasPorCabecalho(['A/I', 'CUSTO', 'LOJAS', 'NOME'], letra);

    expect(traduzirCelulas(celulas, origem, destinoNovo).celulas).toEqual({ C: texto('TNP,LI') });
  });
});

describe('a aba de destino esta pronta?', () => {
  /*
   * Sem `ID` o espelho nao sabe qual linha atualizar: criaria uma nova a cada
   * sincronismo, duplicando o mesmo produto a cada rodada.
   */
  it('recusa aba sem ID', () => {
    const semId = colunasPorCabecalho(['NOME', 'CUSTO'], letra);

    expect(conferirAbaDeDestino(semId)).toEqual({ pronta: false, faltando: ['ID'] });
  });

  it('recusa aba sem NOME — nao da para saber que linha esta livre', () => {
    expect(conferirAbaDeDestino(colunasPorCabecalho(['ID', 'CUSTO'], letra)).faltando).toEqual(['NOME']);
  });

  it('aceita quando as duas existem', () => {
    expect(conferirAbaDeDestino(colunasPorCabecalho(['NOME', 'ID'], letra))).toEqual({ pronta: true, faltando: [] });
  });
});

/*
 * A planilha nova repete cabecalho: `QT` aparece na faixa geral (quantidade da
 * embalagem) e na de transformacao; `CUSTO`, `CODIGO INT.` e as margens
 * aparecem uma vez por LOJA, lado a lado na mesma linha.
 *
 * Casar so por nome pega sempre a primeira ocorrencia — mandaria a quantidade
 * da transformacao para a coluna da embalagem e escreveria tudo da LI dentro da
 * faixa da TNP. A propria planilha marca as faixas na linha 3; e por ela que a
 * ambiguidade se resolve.
 */
describe('faixas — cabecalho repetido resolve pela secao', () => {
  //          A        B    C     D        E     F        G      H
  const l3 = ['', '', '', 'CADASTRO GERAL', '', '', 'TNP - CADASTRO', '', 'LI - CADASTRO'];
  const l5 = ['', '', '', 'NOME', 'QT', 'X', 'CUSTO', 'QT', 'CUSTO'];

  it('acha a faixa de cada coluna', () => {
    const faixas = faixasDaAba(l3, letra);

    expect(faixas.map((f) => f.nome)).toEqual(['CADASTRO GERAL', 'TNP - CADASTRO', 'LI - CADASTRO']);
    expect(faixas[0]).toMatchObject({ inicio: 'D', fim: 'F' });
    expect(faixas[1]).toMatchObject({ inicio: 'G', fim: 'H' });
  });

  it('o MESMO nome cai em coluna diferente conforme a faixa', () => {
    const faixas = faixasDaAba(l3, letra);

    expect(colunaNaFaixa(l5, faixas, 'TNP - CADASTRO', 'CUSTO', letra)).toBe('G');
    expect(colunaNaFaixa(l5, faixas, 'LI - CADASTRO', 'CUSTO', letra)).toBe('I');
  });

  it('QT da faixa geral nao e o QT da outra faixa', () => {
    const faixas = faixasDaAba(l3, letra);

    expect(colunaNaFaixa(l5, faixas, 'CADASTRO GERAL', 'QT', letra)).toBe('E');
    expect(colunaNaFaixa(l5, faixas, 'TNP - CADASTRO', 'QT', letra)).toBe('H');
  });

  /* Melhor nao escrever do que escrever na faixa errada. */
  it('cabecalho que nao existe naquela faixa devolve nada', () => {
    const faixas = faixasDaAba(l3, letra);

    expect(colunaNaFaixa(l5, faixas, 'LI - CADASTRO', 'NOME', letra)).toBeNull();
    expect(colunaNaFaixa(l5, faixas, 'FAIXA QUE NAO EXISTE', 'CUSTO', letra)).toBeNull();
  });

  it('sem nenhuma faixa marcada, nao inventa', () => {
    expect(faixasDaAba(['', '', ''], letra)).toEqual([]);
  });
});
