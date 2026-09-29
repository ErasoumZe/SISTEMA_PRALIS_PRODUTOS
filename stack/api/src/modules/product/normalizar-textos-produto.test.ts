import { describe, expect, it } from 'vitest';
import type { ProductRequests } from '@pralis/shared';
import { normalizarTextosProduto } from './normalizar-textos-produto';

describe('normalização de textos digitados no cadastro', () => {
  it('converte descrições com acentos sem alterar a entrada original', () => {
    const entrada = {
      nome: 'pão de queijo', marca: 'são joão', setorEstoque: 'produção',
      setorVenda1: 'balcão', localVenda1: 'vitrine 1',
      transformacao: { produtoReceituario: 'farinha de trigo', refReceituario: 'ref-a1' },
      codigoBarras: '001234', codigoInterno: 'pr-a1', fotoUrl: 'https://exemplo.test/Foto.png',
      grupo: 'Grupo oficial',
      fiscal: { categoria: 'higiene pessoal', ncm: '01234567' },
    } as ProductRequests.UpdateProductRequest;

    const resultado = normalizarTextosProduto(entrada);

    expect(resultado).toMatchObject({
      nome: 'PÃO DE QUEIJO', marca: 'SÃO JOÃO', setorEstoque: 'PRODUÇÃO',
      setorVenda1: 'BALCÃO', localVenda1: 'VITRINE 1',
      transformacao: { produtoReceituario: 'FARINHA DE TRIGO', refReceituario: 'ref-a1' },
      codigoBarras: '001234', codigoInterno: 'pr-a1', fotoUrl: 'https://exemplo.test/Foto.png',
      grupo: 'Grupo oficial',
      fiscal: { categoria: 'HIGIENE PESSOAL', ncm: '01234567' },
    });
    expect(entrada.nome).toBe('pão de queijo');
    expect(entrada.transformacao?.produtoReceituario).toBe('farinha de trigo');
  });

  it('preserva campos ausentes e nulos em edições parciais', () => {
    expect(normalizarTextosProduto({ marca: null, localVenda2: 'prateleira' })).toEqual({
      marca: null, localVenda2: 'PRATELEIRA',
    });
  });
});
