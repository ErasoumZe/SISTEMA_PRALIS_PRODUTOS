import { describe, expect, it } from 'vitest';
import { fechamentoIncompleto } from './fechamento-confiavel';

describe('fechamentoIncompleto — quando o fechamento do dia não serve', () => {
  it('dia normal: fechamento a poucos por cento dos itens é confiável', () => {
    // 15/10/2025 na TNP
    expect(fechamentoIncompleto({ totalFechamento: 21204.73, totalItens: 21586.96, vendas: 1411, linhas: 8 })).toBe(false);
  });

  it('dia quebrado: R$ 142 em 7 linhas de uma venda contra R$ 22 mil de itens', () => {
    // 27/10/2026 na TNP, como estava gravado em 28/10
    expect(fechamentoIncompleto({ totalFechamento: 141.94, totalItens: 22032.38, vendas: 7, linhas: 7 })).toBe(true);
  });

  it('item digitado errado no PDV não derruba um fechamento certo', () => {
    // 16/01/2026: 1.640 kg de torta inflaram os itens para R$ 102 mil
    expect(fechamentoIncompleto({ totalFechamento: 20220, totalItens: 102833, vendas: 1226, linhas: 7 })).toBe(false);
    // 23/07/2026: R$ 2 milhões em itens num dia de R$ 21 mil
    expect(fechamentoIncompleto({ totalFechamento: 20916, totalItens: 2022028, vendas: 1272, linhas: 7 })).toBe(false);
  });

  it('a régua de valor é metade: abaixo dela, com uma venda por linha, é incompleto', () => {
    expect(fechamentoIncompleto({ totalFechamento: 4999.99, totalItens: 10000, vendas: 2, linhas: 2 })).toBe(true);
    expect(fechamentoIncompleto({ totalFechamento: 5000, totalItens: 10000, vendas: 2, linhas: 2 })).toBe(false);
  });

  it('fechamento MAIOR que os itens não é incompleto (lançamentos do caixa)', () => {
    expect(fechamentoIncompleto({ totalFechamento: 12000, totalItens: 10000, vendas: 1, linhas: 1 })).toBe(false);
  });

  it('sem itens no dia não há com o que comparar: o fechamento vale', () => {
    expect(fechamentoIncompleto({ totalFechamento: 300, totalItens: 0, vendas: 1, linhas: 1 })).toBe(false);
  });
});
