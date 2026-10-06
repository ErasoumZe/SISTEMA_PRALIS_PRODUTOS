import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  PADRAO_TODOS_PESAVEIS, planejarPadronizacao, type EspelhoParaPadronizar, type ProdutoAtivoParaPadronizar,
} from './pesavel-padronizar.plano';

const produto = (id: string, extras: Partial<ProdutoAtivoParaPadronizar> = {}): ProdutoAtivoParaPadronizar => ({
  id, codigoInterno: id, codigoBarras: null, nome: `PRODUTO ${id}`, pesavel: null, teclaBalanca: null, validadeBalanca: null, ...extras,
});
const espelho = (coditem: string, pesavel: string | null, extras: Partial<EspelhoParaPadronizar> = {}): EspelhoParaPadronizar => ({
  id: `e-${coditem}`, coditem, chaveBarras: `b${coditem}`, pesavel, teclaBalanca: null, validadeBalanca: null, ...extras,
});

describe('plano da padronização de pesável — decisão do José em 06/10/2026', () => {
  it('o padrão é S, tecla 000, validade 5', () => {
    expect(PADRAO_TODOS_PESAVEIS).toEqual({ pesavel: 'S', teclaBalanca: 0, validadeBalanca: 5 });
  });

  it('todo ativo que não está no padrão muda, inclusive quem dizia N — e a prévia conta os invertidos', () => {
    const plano = planejarPadronizacao([
      produto('13167', { pesavel: 'N', teclaBalanca: 0, validadeBalanca: 0 }),
      produto('11400', { pesavel: 'S', teclaBalanca: 0, validadeBalanca: 3 }),
      produto('13200'),
      produto('11506', { pesavel: 'S', teclaBalanca: 0, validadeBalanca: 5 }),
    ], []);
    expect(plano.totalAtivos).toBe(4);
    expect(plano.gravar.map((g) => g.produto.id)).toEqual(['13167', '11400', '13200']);
    expect(plano.invertidos).toBe(1);
    expect(plano.semValor).toBe(1);
    expect(plano.jaNoPadrao).toBe(1);
    expect(plano.gravar[0]!.antes).toEqual({ pesavel: 'N', teclaBalanca: 0, validadeBalanca: 0 });
  });

  it('o espelho SIA casado pelo coditem passa a dizer S, 000, 5 — senão o gerador barra por "Pesavel diverge"', () => {
    const plano = planejarPadronizacao(
      [produto('13167', { pesavel: 'N', teclaBalanca: 0, validadeBalanca: 0 })],
      [espelho('13167', 'N', { teclaBalanca: '0', validadeBalanca: '0' })],
    );
    expect(plano.espelhoCorrigir).toEqual([{
      espelhoId: 'e-13167', coditem: '13167', codigoInterno: '13167', nome: 'PRODUTO 13167',
      antes: { pesavel: 'N', teclaBalanca: '0', validadeBalanca: '0' },
      depois: { pesavel: 'S', teclaBalanca: '000', validadeBalanca: '5' },
    }]);
  });

  it('casa o espelho também pelo código de barras, como o gerador faz, e corrige cada linha uma vez só', () => {
    const plano = planejarPadronizacao(
      [produto('13167', { codigoBarras: '7894900011517' })],
      [espelho('999', 'N', { chaveBarras: '7894900011517' }), espelho('13167', 'N')],
    );
    expect(plano.espelhoCorrigir.map((c) => c.espelhoId).sort()).toEqual(['e-13167', 'e-999']);
    expect(plano.semEspelho).toBe(0);
  });

  it('espelho que já diz o padrão não entra; "000" e "5" em texto contam como iguais', () => {
    const plano = planejarPadronizacao(
      [produto('11400', { pesavel: 'S', teclaBalanca: 0, validadeBalanca: 5 })],
      [espelho('11400', 'S', { teclaBalanca: '000', validadeBalanca: '5' })],
    );
    expect(plano.gravar).toHaveLength(0);
    expect(plano.espelhoCorrigir).toHaveLength(0);
    expect(plano.espelhoJaNoPadrao).toBe(1);
  });

  it('espelho S com tecla 000 mas validade diferente é corrigido: o gerador também compara a validade', () => {
    const plano = planejarPadronizacao(
      [produto('11400', { pesavel: 'S', teclaBalanca: 0, validadeBalanca: 5 })],
      [espelho('11400', 'S', { teclaBalanca: '000', validadeBalanca: '3' })],
    );
    expect(plano.espelhoCorrigir).toHaveLength(1);
  });

  it('ativo sem espelho só muda o cadastro; o gerador então usa o cadastro', () => {
    const plano = planejarPadronizacao([produto('13200')], [espelho('77777', 'N')]);
    expect(plano.gravar).toHaveLength(1);
    expect(plano.semEspelho).toBe(1);
    expect(plano.espelhoCorrigir).toHaveLength(0);
  });

  it('zeros à esquerda no coditem do espelho não atrapalham o casamento', () => {
    const plano = planejarPadronizacao([produto('10001')], [espelho('00000000010001', 'N')]);
    expect(plano.espelhoCorrigir.map((c) => c.espelhoId)).toEqual(['e-00000000010001']);
  });
});
