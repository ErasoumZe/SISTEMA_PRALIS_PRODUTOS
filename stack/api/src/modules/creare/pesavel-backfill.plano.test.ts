import { describe, expect, it } from 'vitest';
import { planejarBackfill, type EspelhoParaBackfill, type ProdutoParaBackfill } from './pesavel-backfill.plano';

const produto = (id: string, codigoInterno: string | null, extras: Partial<ProdutoParaBackfill> = {}): ProdutoParaBackfill => ({
  id, codigoInterno, nome: `PRODUTO ${id}`, pesavel: null, teclaBalanca: null, validadeBalanca: null, ...extras,
});
const espelho = (coditem: string, pesavel: string | null, tecla: string | null = null, validade: string | null = null): EspelhoParaBackfill => ({
  id: `e-${coditem}`, coditem, pesavel, teclaBalanca: tecla, validadeBalanca: validade,
});

describe('plano do backfill de pesável', () => {
  it('sem valor em lugar nenhum, aplica o default N — a regra do #124', () => {
    const plano = planejarBackfill([produto('a', '13200')], []);
    expect(plano.gravar).toHaveLength(1);
    expect(plano.gravar[0]).toMatchObject({ origem: 'padrao', pesavel: 'N', teclaBalanca: 0, validadeBalanca: 0 });
    expect(plano.porOrigem).toEqual({ espelho: 0, padrao: 1 });
  });

  it('o espelho SIA vence o default, inclusive tecla e validade', () => {
    const plano = planejarBackfill(
      [produto('a', '10001'), produto('b', '10002')],
      [espelho('10001', 'S', '000', '3'), espelho('10002', 'N')],
    );
    expect(plano.gravar.map((g) => [g.produto.id, g.pesavel, g.teclaBalanca, g.validadeBalanca, g.origem])).toEqual([
      ['a', 'S', 0, 3, 'espelho'],
      ['b', 'N', 0, 0, 'espelho'],
    ]);
    expect(plano.porOrigem).toEqual({ espelho: 2, padrao: 0 });
  });

  it('casa por código normalizado: zeros à esquerda do coditem não atrapalham', () => {
    const plano = planejarBackfill([produto('a', '10001')], [espelho('00000000010001', 'S', '000', '0')]);
    expect(plano.gravar[0]).toMatchObject({ origem: 'espelho', pesavel: 'S', validadeBalanca: 0 });
  });

  it('produto que já tem pesável não é tocado', () => {
    const plano = planejarBackfill(
      [produto('a', '10001', { pesavel: 'N' }), produto('b', '10002', { pesavel: 'S', teclaBalanca: 0, validadeBalanca: 5 })],
      [espelho('10001', 'N'), espelho('10002', 'S', '000', '5')],
    );
    expect(plano.gravar).toHaveLength(0);
    expect(plano.jaDefinidos).toBe(2);
  });

  it('cadastro e espelho discordando é conflito, e ninguém decide por eles', () => {
    const plano = planejarBackfill([produto('a', '10001', { pesavel: 'N' })], [espelho('10001', 'S', '000', '0')]);
    expect(plano.gravar).toHaveLength(0);
    expect(plano.conflitos).toEqual([{ codigoInterno: '10001', nome: 'PRODUTO a', cadastro: 'N', espelho: 'S' }]);
  });

  it('S já definido mas sem tecla/validade é completado pelo espelho', () => {
    const plano = planejarBackfill([produto('a', '10001', { pesavel: 'S' })], [espelho('10001', 'S', '000', '7')]);
    expect(plano.gravar).toHaveLength(0);
    expect(plano.completarBalanca[0]).toMatchObject({ pesavel: 'S', teclaBalanca: 0, validadeBalanca: 7 });
  });

  it('S já definido, sem tecla, e sem espelho que complete: fica como está, para o de-para resolver', () => {
    const plano = planejarBackfill([produto('a', '10001', { pesavel: 'S' })], []);
    expect(plano.completarBalanca).toHaveLength(0);
    expect(plano.jaDefinidos).toBe(1);
  });

  it('espelho S sem tecla/validade não grava S pela metade', () => {
    const plano = planejarBackfill([produto('a', '10001')], [espelho('10001', 'S')]);
    expect(plano.gravar).toHaveLength(0);
    expect(plano.espelhoIncompleto).toEqual(['10001']);
  });

  it('dois espelhos para o mesmo código é ambíguo e fica de fora', () => {
    const plano = planejarBackfill([produto('a', '10001')], [espelho('10001', 'N'), espelho('0010001', 'S', '000', '0')]);
    expect(plano.gravar).toHaveLength(0);
    expect(plano.espelhoAmbiguo).toEqual(['10001']);
  });

  it('produto sem código interno recebe o default, porque não tem como casar com espelho', () => {
    const plano = planejarBackfill([produto('a', null)], [espelho('10001', 'S', '000', '0')]);
    expect(plano.gravar[0]).toMatchObject({ origem: 'padrao', pesavel: 'N' });
  });

  it('espelho com pesável vazio conta como "ninguém diz" e cai no default', () => {
    const plano = planejarBackfill([produto('a', '10001')], [espelho('10001', null)]);
    expect(plano.gravar[0]).toMatchObject({ origem: 'padrao', pesavel: 'N' });
  });

  describe('política manterCadastro — decisão do José em 05/10/2026', () => {
    it('cadastro S contra espelho N: vale o cadastro, e o espelho vira S com tecla 000 e a validade do cadastro', () => {
      const plano = planejarBackfill(
        [produto('a', '11400', { pesavel: 'S', teclaBalanca: 0, validadeBalanca: 3 })],
        [espelho('11400', 'N')],
        { conflitos: 'manterCadastro' },
      );
      expect(plano.conflitos).toHaveLength(0);
      expect(plano.gravar).toHaveLength(0);
      expect(plano.jaDefinidos).toBe(1);
      expect(plano.espelhoCorrigir).toEqual([{
        espelhoId: 'e-11400', codigoInterno: '11400', nome: 'PRODUTO a',
        pesavel: 'S', teclaBalanca: '000', validadeBalanca: '3',
      }]);
    });

    it('cadastro S sem validade: o espelho fica S com validade 0, para o gerador não barrar', () => {
      const plano = planejarBackfill(
        [produto('a', '11506', { pesavel: 'S' })], [espelho('11506', 'N')], { conflitos: 'manterCadastro' },
      );
      expect(plano.espelhoCorrigir[0]).toMatchObject({ pesavel: 'S', teclaBalanca: '000', validadeBalanca: '0' });
    });

    it('cadastro N contra espelho S: o espelho vira N, tecla 0, validade 0', () => {
      const plano = planejarBackfill(
        [produto('a', '10001', { pesavel: 'N' })], [espelho('10001', 'S', '000', '5')], { conflitos: 'manterCadastro' },
      );
      expect(plano.espelhoCorrigir[0]).toMatchObject({ pesavel: 'N', teclaBalanca: '0', validadeBalanca: '0' });
    });

    it('sem conflito, a política não muda nada', () => {
      const bloquear = planejarBackfill([produto('a', '13200'), produto('b', '10001')], [espelho('10001', 'S', '000', '3')]);
      const manter = planejarBackfill([produto('a', '13200'), produto('b', '10001')], [espelho('10001', 'S', '000', '3')], { conflitos: 'manterCadastro' });
      expect(manter).toEqual(bloquear);
    });
  });
});
