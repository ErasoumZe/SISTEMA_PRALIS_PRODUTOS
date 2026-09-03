import { describe, expect, it } from 'vitest';
import { arredondarMoeda, formatarMoeda, parseMoeda } from './money';

describe('formato de dinheiro — sempre duas casas', () => {
  /* O que motivou: o custo aparecia "0,1", e dez centavos parecia um real. */
  it('completa a segunda casa', () => {
    expect(formatarMoeda(0.1)).toBe('0,10');
    expect(formatarMoeda(9.5)).toBe('9,50');
    expect(formatarMoeda(12)).toBe('12,00');
  });

  it('arredonda para o centavo', () => {
    expect(formatarMoeda(1.005)).toBe('1,01');
    expect(formatarMoeda(0.999)).toBe('1,00');
  });

  it('nulo vira VAZIO, nao "0,00" — campo em branco nao e zero', () => {
    expect(formatarMoeda(null)).toBe('');
    expect(formatarMoeda(undefined)).toBe('');
    expect(formatarMoeda(Number.NaN)).toBe('');
  });
});

describe('leitura do que a pessoa digita', () => {
  it('aceita virgula decimal, com ponto de milhar', () => {
    expect(parseMoeda('0,10')).toBe(0.1);
    expect(parseMoeda('1.234,56')).toBe(1234.56);
  });

  /*
   * O erro classico: remover o ponto como se fosse milhar transforma 0.10 em
   * 10 — cem vezes mais caro. Decidir pela presenca da virgula evita isso.
   */
  it('aceita ponto decimal sem inventar milhar', () => {
    expect(parseMoeda('0.10')).toBe(0.1);
    expect(parseMoeda('9.99')).toBe(9.99);
  });

  it('ignora o que nao e numero', () => {
    expect(parseMoeda('R$ 12,50')).toBe(12.5);
  });

  it('vazio e lixo viram NULO, nao zero', () => {
    expect(parseMoeda('')).toBeNull();
    expect(parseMoeda('   ')).toBeNull();
    expect(parseMoeda('abc')).toBeNull();
  });

  it('ida e volta nao muda o valor', () => {
    for (const v of [0.1, 1234.56, 0, 9.99, 100]) {
      expect(parseMoeda(formatarMoeda(v))).toBe(v);
    }
  });
});

describe('arredondamento', () => {
  it('grava o centavo que aparece na tela', () => {
    expect(arredondarMoeda(1.005)).toBe(1.01);
    expect(arredondarMoeda(0.1)).toBe(0.1);
    expect(arredondarMoeda(null)).toBeNull();
  });
});
