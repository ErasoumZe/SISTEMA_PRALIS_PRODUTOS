import { describe, expect, it } from 'vitest';
import {
  cabecalhosPorColuna,
  colunasPorCabecalho,
  conferirAbaDeDestino,
  normalizarCabecalho,
  traduzirCelulas,
  faixasDaAba,
  colunaNaFaixa,
  resolverDestino,
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

    // a primeira faixa e a das colunas ANTES do primeiro rotulo: status e nome
    // do produto moram la, e sem ela nenhum campo dali teria destino
    expect(faixas.map((f) => f.nome)).toEqual([
      '(INICIO)', 'CADASTRO GERAL', 'TNP - CADASTRO', 'LI - CADASTRO',
    ]);
    expect(faixas[0]).toMatchObject({ inicio: 'A', fim: 'C' });
    expect(faixas[1]).toMatchObject({ inicio: 'D', fim: 'F' });
    expect(faixas[2]).toMatchObject({ inicio: 'G', fim: 'H' });
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

/*
 * Onde cada campo vai, sem classificar 50 campos na mao.
 *
 * A regra sai da PROPRIA planilha: se o cabecalho aparece nas faixas de loja,
 * o campo e por loja e vai para a faixa da loja do produto. Se aparece numa
 * faixa so, vai nela. Se aparece em mais de uma faixa que nao e de loja
 * (`QT` na geral e na transformacao), so uma dica explicita resolve — e sem
 * dica NAO escreve, porque chutar a? seria gravar no campo errado.
 */
describe('destino do campo — faixa por faixa', () => {
  //          A   B   C        D                E                F        G
  const l3 = ['', '', 'CADASTRO GERAL', '', 'TRANSFORMAÇÃO', '', 'TNP - CADASTRO', '', 'LI - CADASTRO'];
  const l5 = ['', '', 'CODIGO BARRAS', 'QT', 'PRECISÃO', 'QT', 'CUSTO', 'ESTOQUE MIN', 'CUSTO', 'ESTOQUE MIN'];
  const faixas = faixasDaAba(l3, letra);

  it('campo que so existe numa faixa vai nela, sem precisar de dica', () => {
    expect(resolverDestino({ nome: 'CODIGO BARRAS', faixas, cabecalhos: l5, letra })).toBe('C');
    expect(resolverDestino({ nome: 'PRECISÃO', faixas, cabecalhos: l5, letra })).toBe('E');
  });

  it('campo de LOJA vai para a faixa da loja pedida', () => {
    expect(resolverDestino({ nome: 'CUSTO', loja: 'TNP', faixas, cabecalhos: l5, letra })).toBe('G');
    expect(resolverDestino({ nome: 'CUSTO', loja: 'LI', faixas, cabecalhos: l5, letra })).toBe('I');
  });

  /* Produto da BASE nao preenche faixa de loja: isso e feito na importacao. */
  it('campo de loja SEM loja informada nao escreve', () => {
    expect(resolverDestino({ nome: 'CUSTO', faixas, cabecalhos: l5, letra })).toBeNull();
  });

  it('ambiguo entre faixas nao-loja exige dica', () => {
    expect(resolverDestino({ nome: 'QT', faixas, cabecalhos: l5, letra })).toBeNull();
    expect(resolverDestino({ nome: 'QT', faixa: 'TRANSFORMAÇÃO', faixas, cabecalhos: l5, letra })).toBe('F');
    expect(resolverDestino({ nome: 'QT', faixa: 'CADASTRO GERAL', faixas, cabecalhos: l5, letra })).toBe('D');
  });

  it('campo que a aba nao tem devolve nada', () => {
    expect(resolverDestino({ nome: 'CAMPO INEXISTENTE', faixas, cabecalhos: l5, letra })).toBeNull();
  });
});
