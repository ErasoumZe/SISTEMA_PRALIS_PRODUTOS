import { describe, expect, it } from 'vitest';
import { classificarAbc, diasDeMaximo } from './vendas-abc';

const p = (produto: string, faturamento: number, quantidade = 1) =>
  ({ produtoCodigo: produto, produto, quantidade, faturamento });

describe('classificarAbc — a classe de CADA produto, não só o resumo', () => {
  /**
   * A regra é a do acumulado ANTES do produto entrar: enquanto o que já passou
   * não chegou a 80%, o próximo ainda é A. É o que faz o produto que cruza a
   * linha dos 80% ser A, e não B — sem isso, a classe A nunca somaria 80%.
   */
  it('A vai até o acumulado cruzar 80%, B até 95%, C o resto', () => {
    const r = classificarAbc([
      p('a', 80), p('b', 15), p('c', 5),
    ], 100);

    expect(r.map((i) => [i.produto, i.classe, i.posicao])).toEqual([
      ['a', 'A', 1], ['b', 'B', 2], ['c', 'C', 3],
    ]);
  });

  /**
   * A conta, à mão: ordenado por faturamento fica a=79, c=19, b=2.
   *   a entra com 0% acumulado   -> A, acumulado vai a 79
   *   c entra com 79% acumulado  -> ainda abaixo de 80 -> A, acumulado vai a 98
   *   b entra com 98% acumulado  -> passou de 95 -> C
   * O produto que CRUZA a linha fica na classe de baixo dela, não na de cima.
   */
  it('o produto que cruza os 80% ainda é A', () => {
    const r = classificarAbc([p('a', 79), p('b', 2), p('c', 19)], 100);

    expect(r.map((i) => [i.produto, i.classe])).toEqual([
      ['a', 'A'], ['c', 'A'], ['b', 'C'],
    ]);
  });

  it('ordena do maior faturamento para o menor, e numera a posição', () => {
    const r = classificarAbc([p('pequeno', 10), p('grande', 90)], 100);

    expect(r[0]).toMatchObject({ produto: 'grande', posicao: 1 });
    expect(r[1]).toMatchObject({ produto: 'pequeno', posicao: 2 });
  });

  it('participação e acumulado são percentuais do total do período', () => {
    const r = classificarAbc([p('a', 60), p('b', 40)], 100);

    expect(r[0]).toMatchObject({ participacao: 60, acumulado: 60 });
    expect(r[1]).toMatchObject({ participacao: 40, acumulado: 100 });
  });

  it('total zero não divide por zero', () => {
    const r = classificarAbc([p('a', 0)], 0);

    expect(r[0]).toMatchObject({ participacao: 0, acumulado: 0, classe: 'C' });
  });

  it('lista vazia devolve lista vazia', () => {
    expect(classificarAbc([], 0)).toEqual([]);
  });
});

describe('diasDeMaximo — quanto tempo a prateleira cheia aguenta', () => {
  it('divide o estoque máximo pela venda por dia', () => {
    // 30 unidades de teto, vendendo 3 por dia -> 10 dias
    expect(diasDeMaximo(30, 90, 30)).toBe(10);
  });

  /**
   * Sem máximo cadastrado não há teto para dividir, e sem venda não há ritmo.
   * Nos dois casos a resposta honesta é "não sei" — nunca um número inventado
   * que alguém usaria para decidir compra.
   */
  it('sem máximo cadastrado, ou sem venda, devolve null', () => {
    expect(diasDeMaximo(null, 90, 30)).toBeNull();
    expect(diasDeMaximo(30, 0, 30)).toBeNull();
    expect(diasDeMaximo(0, 90, 30)).toBeNull();
  });

  it('arredonda para uma casa — dia e meio é informação, dia e 0,47 não é', () => {
    expect(diasDeMaximo(10, 90, 30)).toBe(3.3);
  });
});
