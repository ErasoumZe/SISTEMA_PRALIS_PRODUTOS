import { describe, expect, it } from 'vitest';
import {
  dataDaCompra, dinheiro, planejarCusto,
  type LancamentoMer, type ProdutoParaCustear,
} from './custo-mer.motor';

const compra = (over: Partial<LancamentoMer> = {}): LancamentoMer => ({
  linha: 20, produto: 'COCA COLA 600ML', custoUnitario: '4,31', dataRef: '02/03/26', ...over,
});

const produto = (over: Partial<ProdutoParaCustear> = {}): ProdutoParaCustear => ({
  id: 'p1', nome: 'COCA COLA 600ML', custo: null, ...over,
});

const uma = (produtos: ProdutoParaCustear[], lancamentos: LancamentoMer[]) => {
  const r = planejarCusto(produtos, lancamentos);
  expect(r.propostas).toHaveLength(produtos.length);
  return r.propostas[0]!;
};

describe('dinheiro', () => {
  it('lê o formato da planilha', () => {
    expect(dinheiro('4,31')).toBe(4.31);
    expect(dinheiro('1.234,56')).toBe(1234.56);
    expect(dinheiro('R$ 84,90')).toBe(84.9);
  });

  /* Zero seria um número, e o cálculo do preço de venda o trataria como um. */
  it('recusa o que não é dinheiro, e zero também', () => {
    expect(dinheiro('#N/A')).toBeNull();
    expect(dinheiro('')).toBeNull();
    expect(dinheiro('0,00')).toBeNull();
    expect(dinheiro('-3,00')).toBeNull();
  });
});

describe('dataDaCompra', () => {
  it('lê dd/mm/aa e ordena certo', () => {
    expect(dataDaCompra('02/03/26')).toBe(20260302);
    expect(dataDaCompra('28/02/26')).toBe(20260228);
    expect(dataDaCompra('02/03/26')! > dataDaCompra('28/02/26')!).toBe(true);
  });

  it('não confunde dia com mês na virada do ano', () => {
    expect(dataDaCompra('01/12/25')! < dataDaCompra('28/02/26')!).toBe(true);
  });

  it('recusa data ilegível', () => {
    expect(dataDaCompra('')).toBeNull();
    expect(dataDaCompra('MAR 2026')).toBeNull();
    expect(dataDaCompra('32/01/26')).toBeNull();
    expect(dataDaCompra('02/13/26')).toBeNull();
  });
});

describe('planejarCusto', () => {
  it('traz o custo da compra mais recente', () => {
    const p = uma([produto()], [
      compra({ linha: 20, custoUnitario: '4,31', dataRef: '02/03/26' }),
      compra({ linha: 10, custoUnitario: '3,90', dataRef: '01/12/25' }),
    ]);
    expect(p.custoNovo).toBe(4.31);
    expect(p.fonte).toMatch(/linha 20/);
    expect(p.fonte).toMatch(/02\/03\/26/);
  });

  /*
   * A ordem das linhas não decide: a aba não é ordenada por data, e a compra
   * mais recente pode estar acima da mais antiga.
   */
  it('a data manda, não a posição na planilha', () => {
    const p = uma([produto()], [
      compra({ linha: 10, custoUnitario: '4,31', dataRef: '02/03/26' }),
      compra({ linha: 99, custoUnitario: '3,90', dataRef: '01/12/25' }),
    ]);
    expect(p.custoNovo).toBe(4.31);
  });

  it('casa nome ignorando acento, caixa e espaço a mais', () => {
    const p = uma([produto({ nome: 'coca  cola 600ml' })], [compra({ produto: 'COCA COLA 600ML' })]);
    expect(p.custoNovo).toBe(4.31);
  });

  it('produto sem compra nenhuma fica sem custo', () => {
    const p = uma([produto({ nome: 'PRODUTO QUE NINGUEM COMPROU' })], [compra()]);
    expect(p.custoNovo).toBeNull();
    expect(p.motivo).toBe('sem-lancamento');
  });

  /*
   * Dois cadastros com o mesmo nome: não dá para saber a qual deles a nota se
   * refere, e errar atribui custo errado aos dois.
   */
  it('nome repetido no cadastro não recebe custo', () => {
    const r = planejarCusto([produto({ id: 'a' }), produto({ id: 'b' })], [compra()]);
    expect(r.comCusto).toBe(0);
    expect(r.semCusto['nome-ambiguo-no-cadastro']).toBe(2);
  });

  it('lançamento com custo ilegível é ignorado, e a compra anterior vale', () => {
    const p = uma([produto()], [
      compra({ linha: 20, custoUnitario: '#N/A', dataRef: '02/03/26' }),
      compra({ linha: 10, custoUnitario: '3,90', dataRef: '01/12/25' }),
    ]);
    expect(p.custoNovo).toBe(3.9);
  });

  it('não propõe trocar quando o custo já é o mesmo', () => {
    const p = uma([produto({ custo: '4,31' })], [compra({ custoUnitario: '4,31' })]);
    expect(p.custoNovo).toBeNull();
    expect(p.motivo).toBe('ja-esta-certo');
  });

  it('propõe quando o custo mudou, e mostra o que estava lá', () => {
    const p = uma([produto({ custo: '3,90' })], [compra({ custoUnitario: '4,31' })]);
    expect(p.custoAtual).toBe(3.9);
    expect(p.custoNovo).toBe(4.31);
  });

  it('lançamento sem data não ganha de um com data', () => {
    const p = uma([produto()], [
      compra({ linha: 99, custoUnitario: '9,99', dataRef: '' }),
      compra({ linha: 10, custoUnitario: '4,31', dataRef: '02/03/26' }),
    ]);
    expect(p.custoNovo).toBe(4.31);
  });

  it('conta quantos ficaram com custo e por que os outros não', () => {
    const r = planejarCusto(
      [
        produto({ id: 'a' }),
        produto({ id: 'b', nome: 'SEM COMPRA' }),
        produto({ id: 'c', nome: 'SPRITE LATA 220ML', custo: '1,85' }),
      ],
      [compra(), compra({ produto: 'SPRITE LATA 220ML', custoUnitario: '1,85' })],
    );
    expect(r.comCusto).toBe(1);
    expect(r.semCusto).toMatchObject({ 'sem-lancamento': 1, 'ja-esta-certo': 1 });
  });
});
