import { describe, expect, it } from 'vitest';
import { fechamentoIncompleto } from './fechamento-confiavel';

describe('fechamentoIncompleto — quando o fechamento do dia não serve', () => {
  it('dia normal: fechamento a poucos por cento dos itens é confiável', () => {
    // 15/10/2025 na TNP
    expect(fechamentoIncompleto(21204.73, 21586.96)).toBe(false);
  });

  it('dia quebrado: fechamento de R$ 142 contra R$ 22 mil de itens é incompleto', () => {
    // 27/10/2026 na TNP, como estava gravado em 28/10
    expect(fechamentoIncompleto(141.94, 22032.38)).toBe(true);
  });

  it('a régua é metade: abaixo dela é incompleto, a partir dela não', () => {
    expect(fechamentoIncompleto(4999.99, 10000)).toBe(true);
    expect(fechamentoIncompleto(5000, 10000)).toBe(false);
  });

  it('fechamento MAIOR que os itens não é incompleto (lançamentos do caixa)', () => {
    expect(fechamentoIncompleto(12000, 10000)).toBe(false);
  });

  it('sem itens no dia não há com o que comparar: o fechamento vale', () => {
    expect(fechamentoIncompleto(300, 0)).toBe(false);
  });
});
