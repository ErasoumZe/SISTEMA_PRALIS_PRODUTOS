import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { filtroVazio, passaNoFiltro, type ProdutoCadastro } from './vendas-margem';

/*
 * Setor e grupo não existem na venda — existem no produto do cadastro com que
 * ela casou. Estes testes fixam as três decisões que fazem o filtro honesto:
 * ele só corta itens, venda sem cadastro não passa em setor/grupo, e o texto
 * de produto casa sem acento e sem caixa como a caixa de busca.
 */

const cadastro = (over: Partial<ProdutoCadastro> = {}): ProdutoCadastro => ({
  id: 'p1', nome: 'PÃO FRANCÊS KG', codigoBarras: '2000000011151', custo: 8, qtCad: 1,
  grupo: 'PANIFICAÇÃO', setorEstoque: 'PROD. - PADARIA', setorVenda1: 'BALCÃO',
  estoqueMin: null, estoqueMax: null, ...over,
} as ProdutoCadastro);

const venda = { produtoCodigo: '2000000011151', produto: 'PAO FRANCES' };

describe('filtroVazio', () => {
  it('trata ausência, vazio e espaço como "sem filtro"', () => {
    expect(filtroVazio(undefined)).toBe(true);
    expect(filtroVazio({})).toBe(true);
    expect(filtroVazio({ setor: '  ', grupo: '', produto: null })).toBe(true);
    expect(filtroVazio({ setor: 'PADARIA' })).toBe(false);
  });
});

describe('passaNoFiltro', () => {
  it('sem filtro, tudo passa — inclusive venda sem cadastro', () => {
    expect(passaNoFiltro(null, venda, {})).toBe(true);
  });

  it('setor casa pelo campo do cadastro, sem acento e sem caixa', () => {
    expect(passaNoFiltro(cadastro(), venda, { setor: 'prod. - padaria' })).toBe(true);
    expect(passaNoFiltro(cadastro(), venda, { setor: 'CONFEITARIA' })).toBe(false);
  });

  it('respeita o campo de setor escolhido (estoque x venda)', () => {
    expect(passaNoFiltro(cadastro(), venda, { setor: 'BALCÃO', campoSetor: 'setorVenda1' })).toBe(true);
    expect(passaNoFiltro(cadastro(), venda, { setor: 'BALCÃO' })).toBe(false);
  });

  /*
   * A decisão que evita número inventado: venda que não casou com produto
   * nenhum não tem setor, então NÃO entra no recorte "setor = padaria".
   * Mostrá-la seria classificar o que ninguém classificou.
   */
  it('venda sem cadastro não passa em filtro de setor ou grupo', () => {
    expect(passaNoFiltro(null, venda, { setor: 'PROD. - PADARIA' })).toBe(false);
    expect(passaNoFiltro(null, venda, { grupo: 'PANIFICAÇÃO' })).toBe(false);
  });

  it('grupo casa pelo cadastro', () => {
    expect(passaNoFiltro(cadastro(), venda, { grupo: 'panificação' })).toBe(true);
    expect(passaNoFiltro(cadastro({ grupo: null }), venda, { grupo: 'PANIFICAÇÃO' })).toBe(false);
  });

  it('produto casa por trecho do nome vendido, do código ou do nome no cadastro', () => {
    expect(passaNoFiltro(cadastro(), venda, { produto: 'pao fran' })).toBe(true);
    expect(passaNoFiltro(cadastro(), venda, { produto: '11151' })).toBe(true);
    expect(passaNoFiltro(cadastro(), venda, { produto: 'francês kg' })).toBe(true);
    expect(passaNoFiltro(null, venda, { produto: 'pao' })).toBe(true); // sem cadastro, o nome vendido basta
    expect(passaNoFiltro(cadastro(), venda, { produto: 'bolo' })).toBe(false);
  });

  it('filtros combinam por E', () => {
    expect(passaNoFiltro(cadastro(), venda, { setor: 'PROD. - PADARIA', grupo: 'PANIFICAÇÃO', produto: 'pao' })).toBe(true);
    expect(passaNoFiltro(cadastro(), venda, { setor: 'PROD. - PADARIA', grupo: 'BEBIDAS' })).toBe(false);
  });
});
