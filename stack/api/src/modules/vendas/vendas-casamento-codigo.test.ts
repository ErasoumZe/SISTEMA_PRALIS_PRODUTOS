import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { chaveDePara, codigoInternoDaVenda, indexarPorCodigo, resolverProduto, type ProdutoCadastro } from './vendas-margem';

/*
 * Visto em produção em 25/09/2026: a Curva ABC inteira "fora do cadastro". O
 * Creare manda `00000000010824` para produto sem etiqueta — é o coditem 10824
 * zero-preenchido — e o casamento só tentava código de barras.
 */
const prod = (over: Partial<ProdutoCadastro>): ProdutoCadastro => ({
  id: 'p', nome: 'X', codigoBarras: null, codigoInterno: null, custo: null, qtCad: 1, ...over,
});

describe('codigoInternoDaVenda', () => {
  it('lê o coditem zero-preenchido e o código curto cru', () => {
    expect(codigoInternoDaVenda('00000000010824')).toBe('10824');
    expect(codigoInternoDaVenda('10824')).toBe('10824');
  });

  it('não confunde etiqueta de verdade (8+ dígitos) com código interno', () => {
    expect(codigoInternoDaVenda('07891000460207')).toBeNull();
    expect(codigoInternoDaVenda('00000078939318')).toBeNull(); // EAN-8 zero-preenchido
    expect(codigoInternoDaVenda('0000000000000')).toBeNull();
    expect(codigoInternoDaVenda('')).toBeNull();
  });
});

describe('resolverProduto pelo código interno', () => {
  const biscoito = prod({ id: 'b', nome: 'BISCOITO POLVILHO CEBOLA KG', codigoInterno: '10824' });
  const coca = prod({ id: 'c', nome: 'COCA 350', codigoBarras: '7894900011517', codigoInterno: '10400' });
  const indice = indexarPorCodigo([biscoito, coca]);

  it('casa o coditem zero-preenchido com o código interno do cadastro', () => {
    expect(resolverProduto('00000000010824', 'BISCOITO POLVILHO CEBOLA KG', indice, new Map())?.id).toBe('b');
  });

  it('etiqueta continua casando pelo código de barras', () => {
    expect(resolverProduto('7894900011517', 'COCA', indice, new Map())?.id).toBe('c');
  });

  it('código interno duplicado no cadastro não casa com nenhum dos dois', () => {
    const dup = indexarPorCodigo([biscoito, prod({ id: 'b2', codigoInterno: '010824' })]);
    expect(resolverProduto('00000000010824', 'X', dup, new Map())).toBeNull();
  });

  it('o de-para confirmado continua vencendo', () => {
    const manual = prod({ id: 'm' });
    const dePara = new Map([[chaveDePara('00000000010824', 'BISCOITO'), manual]]);
    expect(resolverProduto('00000000010824', 'BISCOITO', indice, dePara)?.id).toBe('m');
  });
});
