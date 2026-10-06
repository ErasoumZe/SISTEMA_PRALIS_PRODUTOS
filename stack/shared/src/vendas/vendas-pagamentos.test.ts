import { describe, expect, it } from 'vitest';
import { resumirPagamentos } from './vendas-pagamentos';

const FORMAS = [
  { chave: 'dinheiro', label: 'Dinheiro' },
  { chave: 'pix', label: 'Pix' },
  { chave: 'debito', label: 'Débito' },
  { chave: 'rouboFurto', label: 'Roubo/furto' },
];

describe('resumo das formas de pagamento', () => {
  it('soma os dias e devolve a fatia de cada forma, da maior para a menor', () => {
    const r = resumirPagamentos([
      { dinheiro: 100, pix: 300, debito: 100, rouboFurto: 0 },
      { dinheiro: 100, pix: 300, debito: 100, rouboFurto: 0 },
    ], FORMAS);

    expect(r.total).toBe(1000);
    expect(r.itens.map((i) => [i.chave, i.total, i.percentual])).toEqual([
      ['pix', 600, 60],
      ['dinheiro', 200, 20],
      ['debito', 200, 20],
    ]);
  });

  it('forma sem movimento fica de fora, e é contada', () => {
    const r = resumirPagamentos([{ dinheiro: 50, pix: 0, debito: 0, rouboFurto: 0 }], FORMAS);

    expect(r.itens).toHaveLength(1);
    expect(r.semMovimento).toBe(3);
  });

  it('período sem fechamento devolve zero, não NaN', () => {
    const r = resumirPagamentos([], FORMAS);

    expect(r.total).toBe(0);
    expect(r.itens).toEqual([]);
    expect(r.semMovimento).toBe(4);
  });

  it('coluna ausente ou com texto conta como zero', () => {
    const r = resumirPagamentos([{ dinheiro: '100', pix: null }] as never, FORMAS);

    expect(r.total).toBe(100);
    expect(r.itens[0]).toMatchObject({ chave: 'dinheiro', total: 100 });
  });

  it('ajuste negativo entra como está e diminui a base', () => {
    const r = resumirPagamentos([{ dinheiro: 100, pix: 0, debito: 0, rouboFurto: -20 }], FORMAS);

    expect(r.total).toBe(80);
    expect(r.itens.map((i) => i.chave)).toEqual(['dinheiro', 'rouboFurto']);
    expect(r.itens[0]!.percentual).toBe(125);
    expect(r.itens[1]!.percentual).toBe(-25);
  });

  it('as fatias somam 100% quando ninguém é negativo', () => {
    const r = resumirPagamentos([{ dinheiro: 33, pix: 33, debito: 34, rouboFurto: 0 }], FORMAS);

    expect(r.itens.reduce((acc, i) => acc + i.percentual, 0)).toBeCloseTo(100, 10);
  });
});
