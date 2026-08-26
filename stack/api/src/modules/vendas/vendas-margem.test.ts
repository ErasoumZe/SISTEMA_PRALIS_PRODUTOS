import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  calcularMargem, custoUnitario, indexarPorCodigo, resolverProduto, semelhanca,
  type LinhaVenda, type ProdutoCadastro,
} from './vendas-margem';

const prod = (over: Partial<ProdutoCadastro> = {}): ProdutoCadastro =>
  ({ id: 'p1', nome: 'PRODUTO', codigoBarras: null, custo: null, qtCad: 1, ...over });

const venda = (over: Partial<LinhaVenda> = {}): LinhaVenda =>
  ({ produtoCodigo: '', produto: 'X', quantidade: 1, total: 10, ...over });

const vazio = new Map<string, ProdutoCadastro>();

describe('indexarPorCodigo — casamento automático', () => {
  it('casa pelo EAN normal', () => {
    const indice = indexarPorCodigo([prod({ id: 'a', codigoBarras: '7891234000019' })]);

    expect(indice.get('7891234000019')?.id).toBe('a');
  });

  it('EAN de balança também casa pelo PLU — é o que faz pão e granel casarem', () => {
    // 2 + PLU(10001) + peso + digito: o Creare exporta o pesável como "10001"
    const indice = indexarPorCodigo([prod({ id: 'granel', codigoBarras: '2100010000005' })]);

    expect(indice.get('10001')?.id).toBe('granel');
    expect(resolverProduto('10001', 'GRANEL', indice, vazio)?.id).toBe('granel');
  });

  it('zero à esquerda não impede o casamento', () => {
    const indice = indexarPorCodigo([prod({ id: 'z', codigoBarras: '0010001' })]);

    expect(resolverProduto('10001', 'Z', indice, vazio)?.id).toBe('z');
  });

  it('chave AMBÍGUA some do índice em vez de casar com o produto errado', () => {
    const indice = indexarPorCodigo([
      prod({ id: 'a', codigoBarras: '2100010000005' }),
      prod({ id: 'b', codigoBarras: '2100010000999' }), // mesmo PLU 10001
    ]);

    // ambos gerariam a chave 10001 -> ninguém casa, vira pendência de de-para
    expect(indice.has('10001')).toBe(false);
    expect(resolverProduto('10001', 'AMBIGUO', indice, vazio)).toBeNull();
  });

  it('produto sem código de barras não entra no índice', () => {
    expect(indexarPorCodigo([prod({ codigoBarras: null })]).size).toBe(0);
  });
});

describe('resolverProduto — o de-para humano manda', () => {
  it('o vínculo confirmado tem precedência sobre o automático', () => {
    const automatico = prod({ id: 'auto', codigoBarras: '7891234000019' });
    const escolhido = prod({ id: 'manual' });
    const indice = indexarPorCodigo([automatico]);
    const dePara = new Map([['7891234000019|NOME NO PDV', escolhido]]);

    expect(resolverProduto('7891234000019', 'NOME NO PDV', indice, dePara)?.id).toBe('manual');
  });

  it('código desconhecido devolve null, não um palpite', () => {
    expect(resolverProduto('999', 'X', indexarPorCodigo([prod({ codigoBarras: '111' })]), vazio)).toBeNull();
  });
});

describe('custoUnitario — o cadastro guarda o custo da EMBALAGEM', () => {
  it('divide pela quantidade da embalagem', () => {
    expect(custoUnitario(prod({ custo: 100, qtCad: 4 }))).toBe(25);
  });

  it('qtCad zero não divide por zero', () => {
    expect(custoUnitario(prod({ custo: 10, qtCad: 0 }))).toBe(10);
  });

  it('produto sem custo devolve null — não zero', () => {
    expect(custoUnitario(prod({ custo: null }))).toBeNull();
  });
});

describe('calcularMargem — cobertura sempre declarada', () => {
  const comCusto = prod({ id: 'c', codigoBarras: '111', custo: 6, qtCad: 1 });

  it('calcula lucro e margem sobre o que TEM custo', () => {
    const indice = indexarPorCodigo([comCusto]);
    const m = calcularMargem([venda({ produtoCodigo: '111', quantidade: 2, total: 20 })], indice, vazio);

    expect(m.custoTotal).toBe(12);
    expect(m.lucroBruto).toBe(8);
    expect(m.margemPercentual).toBe(40);
    expect(m.coberturaPercentual).toBe(100);
  });

  it('faturamento sem custo NÃO entra na margem, mas derruba a cobertura', () => {
    const indice = indexarPorCodigo([comCusto]);
    const m = calcularMargem([
      venda({ produtoCodigo: '111', quantidade: 1, total: 10 }),
      venda({ produtoCodigo: '999', produto: 'DESCONHECIDO', quantidade: 1, total: 30 }),
    ], indice, vazio);

    expect(m.faturamentoComCusto).toBe(10);
    expect(m.faturamentoSemCusto).toBe(30);
    expect(m.coberturaPercentual).toBe(25); // 10 de 40
    expect(m.margemPercentual).toBe(40); // (10-6)/10 — sobre o coberto, não sobre 40
    expect(m.produtosSemVinculo).toBe(1);
  });

  it('produto encontrado mas SEM custo cadastrado conta como sem cobertura', () => {
    const indice = indexarPorCodigo([prod({ id: 's', codigoBarras: '222', custo: null })]);
    const m = calcularMargem([venda({ produtoCodigo: '222', total: 50 })], indice, vazio);

    expect(m.faturamentoSemCusto).toBe(50);
    expect(m.coberturaPercentual).toBe(0);
  });

  it('o mesmo código em dias diferentes conta como UM produto sem vínculo', () => {
    const m = calcularMargem([
      venda({ produtoCodigo: '999', produto: 'A', total: 10 }),
      venda({ produtoCodigo: '999', produto: 'A', total: 10 }),
    ], vazio, vazio);

    expect(m.produtosSemVinculo).toBe(1);
  });

  it('sem venda nenhuma não gera NaN', () => {
    const m = calcularMargem([], vazio, vazio);

    expect(m).toMatchObject({ coberturaPercentual: 0, margemPercentual: 0, lucroBruto: 0 });
    expect(Object.values(m).every((v) => Number.isFinite(v))).toBe(true);
  });

  it('prejuízo aparece como lucro negativo, não é escondido', () => {
    const indice = indexarPorCodigo([prod({ id: 'p', codigoBarras: '333', custo: 20, qtCad: 1 })]);
    const m = calcularMargem([venda({ produtoCodigo: '333', quantidade: 1, total: 10 })], indice, vazio);

    expect(m.lucroBruto).toBe(-10);
    expect(m.margemPercentual).toBe(-100);
  });
});

describe('semelhanca — só para ordenar sugestão', () => {
  it('nome idêntico é 100', () => {
    expect(semelhanca('PAO FRANCES', 'pão frances')).toBe(100);
  });

  it('nome parecido pontua alto', () => {
    expect(semelhanca('PAO FRANCES KG', 'PAO FRANCES 1 KG')).toBeGreaterThan(70);
  });

  it('nome diferente pontua baixo', () => {
    expect(semelhanca('PAO FRANCES', 'COCA COLA 2L')).toBeLessThan(30);
  });

  it('texto vazio não quebra', () => {
    expect(semelhanca('', 'QUALQUER')).toBe(0);
  });
});
