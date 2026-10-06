import { describe, expect, it } from 'vitest';
import {
  formatarPercentual, formatarPontos, formatarQuantidade, participacao, pontosComUnidade,
} from './formato';

describe('formato dos números de venda', () => {
  describe('pontuação sem casa decimal — decisão do José em 06/10/2026', () => {
    it('arredonda e usa separador de milhar', () => {
      expect(formatarPontos(2284.78)).toBe('2.285');
      expect(formatarPontos(2284.4)).toBe('2.284');
      expect(formatarPontos(0)).toBe('0');
      expect(formatarPontos(9139.11)).toBe('9.139');
    });

    it('meio ponto sobe', () => {
      expect(formatarPontos(0.5)).toBe('1');
      expect(formatarPontos(1.5)).toBe('2');
    });

    it('nulo e número impossível viram zero, não "NaN"', () => {
      expect(formatarPontos(null)).toBe('0');
      expect(formatarPontos(undefined)).toBe('0');
      expect(formatarPontos(Number.NaN)).toBe('0');
      expect(formatarPontos(Number.POSITIVE_INFINITY)).toBe('0');
    });

    it('a unidade vem colada onde a tela usa', () => {
      expect(pontosComUnidade(2284.78)).toBe('2.285 pts');
    });
  });

  describe('percentual', () => {
    it('uma casa decimal, valor já em 0 a 100', () => {
      expect(formatarPercentual(2.14)).toBe('2,1%');
      expect(formatarPercentual(100)).toBe('100%');
      expect(formatarPercentual(0)).toBe('0%');
    });

    it('quem vendeu pouco não aparece como zero', () => {
      expect(formatarPercentual(0.04)).toBe('<0,1%');
      expect(formatarPercentual(0.1)).toBe('0,1%');
    });

    it('aceita outra precisão quando o acumulado pede', () => {
      expect(formatarPercentual(2.148, 2)).toBe('2,15%');
      expect(formatarPercentual(0.004, 2)).toBe('<0,01%');
    });
  });

  describe('quantidade', () => {
    it('mantém as casas do produto de balança', () => {
      expect(formatarQuantidade(2.5)).toBe('2,5');
      expect(formatarQuantidade(1234)).toBe('1.234');
      expect(formatarQuantidade(0.125)).toBe('0,13');
    });
  });

  describe('participação', () => {
    it('devolve a fatia em 0 a 100', () => {
      expect(participacao(25, 100)).toBe(25);
      expect(participacao(1, 3)).toBeCloseTo(33.333, 3);
    });

    it('total zero não vira NaN nem divisão por zero', () => {
      expect(participacao(10, 0)).toBe(0);
      expect(participacao(0, 0)).toBe(0);
      expect(participacao(null, null)).toBe(0);
    });
  });
});
