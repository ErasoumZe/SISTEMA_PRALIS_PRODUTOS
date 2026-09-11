import { describe, expect, it } from 'vitest';
import { formatoCreare, parseCampoCreare } from './formato-creare';

describe('parseCampoCreare — casas decimais implícitas', () => {
  it('respeita a escala que o chamador diz, porque ela não é uniforme', () => {
    expect(parseCampoCreare('5333', 2)).toBe(53.33); // REDUCAO_ICMS
    expect(parseCampoCreare('18000', 3)).toBe(18); // ALIQUOTA CHEIA
  });

  it('aceita o formato já pontuado que aparece em % NCM e ICMS', () => {
    expect(parseCampoCreare('0,00', 2)).toBe(0);
  });

  it('lixo vira ausência, nunca zero — zero é uma afirmação', () => {
    expect(parseCampoCreare('X', 2)).toBeNull();
    expect(parseCampoCreare('', 2)).toBeNull();
  });
});

describe('formatoCreare — a volta, na grafia que a coluna espera', () => {
  it('devolve o inteiro de largura fixa que o cadastro de origem tinha', () => {
    expect(formatoCreare(53.33, 2, 4)).toBe('5333'); // REDUCAO_ICMS
    expect(formatoCreare(18, 3, 5)).toBe('18000'); // ALIQUOTA CHEIA
  });

  it('completa com zero à esquerda até a largura do campo', () => {
    expect(formatoCreare(7, 2, 4)).toBe('0700');
    expect(formatoCreare(0, 4, 8)).toBe('00000000');
  });

  /**
   * A ida e a volta têm de fechar. Se não fechassem, a planilha e o Creare
   * passariam a discordar do mesmo número — e ninguém perceberia, porque os
   * dois lados continuariam exibindo algo plausível.
   */
  it('fecha o ciclo com parseCampoCreare', () => {
    const casos: Array<[string, number, number]> = [
      ['5333', 2, 4],
      ['6111', 2, 4],
      ['18000', 3, 5],
      ['00000000', 4, 8],
    ];
    for (const [bruto, casas, largura] of casos) {
      expect(formatoCreare(parseCampoCreare(bruto, casas), casas, largura)).toBe(bruto);
    }
  });

  it('ausência continua ausência — não vira "0000"', () => {
    expect(formatoCreare(null, 2, 4)).toBeNull();
    expect(formatoCreare(undefined, 2, 4)).toBeNull();
    expect(formatoCreare(Number.NaN, 2, 4)).toBeNull();
  });
});
