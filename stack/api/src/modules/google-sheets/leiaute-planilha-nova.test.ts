import { describe, it, expect } from 'vitest';
import { lerLeiaute, traduzirParaPlanilhaNova, colunaDoCampo } from './leiaute-planilha-nova';
import type { CellMap } from './product-sheet.mapper';

const letra = (i: number): string => {
  let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

const texto = (v: string) => ({ kind: 'text' as const, value: v });

/*
 * Recorte da planilha nova com os casos que importam:
 *  - colunas antes do primeiro rotulo (status e nome);
 *  - `QT` repetido na faixa geral e na de transformacao;
 *  - `CUSTO` uma vez por loja.
 *
 *          A   B   C(V) D(nome)      E     F(rotulo)          G(QT)  H          I(QT) J(CUSTO) K(CUSTO)
 */
const L3 = ['', '', '', '', '', 'CADASTRO GERAL', '', 'TRANSFORMAÇÃO', '', 'TNP - CADASTRO', 'LI - CADASTRO'];
const L5 = ['', '', 'V', 'CADASTRO PRODUTOS ATUALIZADO NOVO', '', 'CODIGO BARRAS', 'QT', 'PRECISÃO', 'QT', 'CUSTO', 'CUSTO'];

const leiaute = lerLeiaute(L3, L5, letra);

describe('traducao para a planilha nova', () => {
  it('nome e status caem nas colunas ANTES do primeiro rotulo', () => {
    const celulas: CellMap = { E: texto('PAO FRANCES KG'), C: texto('ATIVO') };

    const { celulas: r } = traduzirParaPlanilhaNova(celulas, leiaute, null, letra);

    expect(r.D).toEqual(texto('PAO FRANCES KG')); // NOME -> CADASTRO PRODUTOS ATUALIZADO NOVO
    expect(r.C).toEqual(texto('ATIVO')); // A/I -> V
  });

  /* O caso que motivou o tradutor por faixa. */
  it('QT_CAD e QT_TR nao caem na mesma coluna', () => {
    const celulas: CellMap = { N: texto('20'), W: texto('500') };

    const { celulas: r } = traduzirParaPlanilhaNova(celulas, leiaute, null, letra);

    expect(r.G).toEqual(texto('20')); // QT_CAD -> faixa geral
    expect(r.I).toEqual(texto('500')); // QT_TR -> faixa de transformacao
  });

  it('CUSTO vai para a faixa da loja pedida', () => {
    const celulas: CellMap = { AJ: texto('12,90') };

    expect(traduzirParaPlanilhaNova(celulas, leiaute, 'TNP', letra).celulas.J).toEqual(texto('12,90'));
    expect(traduzirParaPlanilhaNova(celulas, leiaute, 'LI', letra).celulas.K).toEqual(texto('12,90'));
  });

  /* A BASE cadastra ate o grupo; quem preenche custo e a loja, ao importar. */
  it('produto da BASE NAO escreve na faixa de loja', () => {
    const celulas: CellMap = { AJ: texto('12,90'), E: texto('PAO') };

    const { celulas: r, semDestino, adiadosParaALoja } = traduzirParaPlanilhaNova(celulas, leiaute, null, letra);

    expect(r.J).toBeUndefined();
    expect(r.K).toBeUndefined();
    expect(r.D).toEqual(texto('PAO')); // o que e da base continua indo

    // ADIADO, nao "sem destino": a coluna existe, quem preenche e a loja
    expect(adiadosParaALoja).toContain('CUSTO');
    expect(semDestino).not.toContain('CUSTO');
  });

  it('LOJAS e descartada — era constante, nao dado do produto', () => {
    const { celulas: r, semDestino } = traduzirParaPlanilhaNova(
      { D: texto('TNP,LI,HORA') }, leiaute, null, letra,
    );

    expect(Object.keys(r)).toEqual([]);
    expect(semDestino).not.toContain('LOJAS'); // ignorada de proposito, nao "faltando"
  });

  it('coluna sem campo conhecido nao vira escrita as cegas', () => {
    const { celulas: r } = traduzirParaPlanilhaNova({ ZZ: texto('?') }, leiaute, null, letra);

    expect(Object.keys(r)).toEqual([]);
  });

  it('acha a coluna do ID para a busca da linha', () => {
    const comId = lerLeiaute(L3, [...L5, 'ID'], letra);

    expect(colunaDoCampo(comId, 'ID', letra)).toBe('L');
    expect(colunaDoCampo(leiaute, 'ID', letra)).toBeNull();
  });
});
