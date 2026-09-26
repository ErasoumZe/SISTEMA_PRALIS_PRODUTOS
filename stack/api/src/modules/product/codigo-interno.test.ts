import { describe, expect, it } from 'vitest';
import {
  PRIMEIRO_CODIGO_FORA_DA_FAIXA, ULTIMO_CODIGO_DE_PRODUTO,
  calcularProximoCodigoInterno, maiorCodigoDaFaixa,
} from './codigo-interno';

describe('calcularProximoCodigoInterno', () => {
  it('começa em 13130 quando não há nada salvo', () => {
    // 13129 é o último produto cadastrado; o próximo novo é o 13130
    expect(calcularProximoCodigoInterno(0)).toBe('13130');
  });

  it('não volta para trás quando o maior salvo é menor que o piso', () => {
    // os códigos históricos (00001–00428) existem e continuam valendo
    expect(calcularProximoCodigoInterno(442)).toBe('13130');
  });

  it('continua a sequência a partir do maior salvo', () => {
    expect(calcularProximoCodigoInterno(ULTIMO_CODIGO_DE_PRODUTO)).toBe('13130');
    expect(calcularProximoCodigoInterno(13_130)).toBe('13131');
    expect(calcularProximoCodigoInterno(20_000)).toBe('20001');
  });

  it('passa de cinco dígitos sem truncar', () => {
    expect(calcularProximoCodigoInterno(99_999)).toBe('100000');
  });
});

describe('maiorCodigoDaFaixa', () => {
  it('ignora a faixa alta de entrega e equipamento', () => {
    /*
     * A carga de 25/09/2026 trouxe 712931, 713118 e 719000 junto com os
     * produtos. Contá-los faria o próximo cadastro sair em 719001.
     */
    expect(maiorCodigoDaFaixa(['13129', '712931', '719000'])).toBe(13_129);
    expect(calcularProximoCodigoInterno(maiorCodigoDaFaixa(['13129', '719000']))).toBe('13130');
  });

  it('aceita o código formatado como a planilha mostra', () => {
    expect(maiorCodigoDaFaixa(['13.129', '00007'])).toBe(13_129);
  });

  it('devolve o piso quando não sobra nada na faixa', () => {
    expect(maiorCodigoDaFaixa([])).toBe(ULTIMO_CODIGO_DE_PRODUTO);
    expect(maiorCodigoDaFaixa([null, '', 'abc', String(PRIMEIRO_CODIGO_FORA_DA_FAIXA)])).toBe(ULTIMO_CODIGO_DE_PRODUTO);
  });
});
