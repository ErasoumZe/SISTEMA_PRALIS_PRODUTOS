import { describe, expect, it } from 'vitest';
import { planejarPesaveis, type ProdutoPesavelAtual, type EspelhoPesavelAtual } from './pesaveis-plano';
import type { PesavelDaExportacao } from './pesaveis-exportacao';

const fonte: PesavelDaExportacao[] = [
  { codigoInterno: '12535', nome: 'PUDIM', validadeDias: 0, status: 'A', linha: 2 },
  { codigoInterno: '12658', nome: 'BOLO', validadeDias: 6, status: 'I', linha: 3 },
];
const produto = (id: string, codigoInterno: string, pesavel: string | null): ProdutoPesavelAtual => ({
  id, codigoInterno, nome: id, pesavel, teclaBalanca: null, validadeBalanca: null,
});
const espelho = (id: string, coditem: string, pesavel: string | null): EspelhoPesavelAtual => ({
  id, coditem, pesavel, teclaBalanca: null, validadeBalanca: null,
});

describe('plano de pesáveis TNP', () => {
  it('muda N para S e alinha espelho sem tocar em códigos ausentes', () => {
    const plano = planejarPesaveis(fonte,
      [produto('p1', '00012535', 'N'), produto('p2', '12658', null), produto('outro', '10000', 'N')],
      [espelho('s1', '12535', 'N')]);
    expect(plano.atualizarProdutos.map((p) => p.atual.id)).toEqual(['p1', 'p2']);
    expect(plano.atualizarEspelhos.map((p) => p.atual.id)).toEqual(['s1']);
    expect(plano.semEspelho).toEqual(['12658']);
  });

  it('não escolhe produto de código duplicado', () => {
    const plano = planejarPesaveis(fonte.slice(0, 1),
      [produto('p1', '12535', 'N'), produto('p2', '00012535', 'S')], []);
    expect(plano.codigoAmbiguo).toEqual(['12535']);
    expect(plano.atualizarProdutos).toEqual([]);
  });

  it('mantém um cadastro e espelho já corretos', () => {
    const p = { ...produto('p1', '12535', 'S'), teclaBalanca: 0, validadeBalanca: 0 };
    const s = { ...espelho('s1', '12535', 'S'), teclaBalanca: '000', validadeBalanca: '0' };
    const plano = planejarPesaveis(fonte.slice(0, 1), [p], [s]);
    expect(plano.atualizarProdutos).toEqual([]);
    expect(plano.atualizarEspelhos).toEqual([]);
    expect(plano.jaCorretos).toBe(1);
  });
});
