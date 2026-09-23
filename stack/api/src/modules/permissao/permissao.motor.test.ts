import { describe, expect, it } from 'vitest';
import { Telas } from '@pralis/shared';
import {
  ehAdminRaiz,
  podeGerenciar,
  podeVer,
  telasDe,
  type PessoaPermissao,
} from './permissao.motor';

const RAIZ = 'rodrigo@cicluz.com.br';

const rodrigo: PessoaPermissao = { id: 'r', email: 'Rodrigo@Cicluz.com.BR', role: 'admin' };
const jose: PessoaPermissao = { id: 'j', email: 'sistema@cicluz.com.br', role: 'admin' };
const outroAdmin: PessoaPermissao = { id: 'a2', email: 'admin2@cicluz.com.br', role: 'admin' };
const giulia: PessoaPermissao = { id: 'g', email: 'giulia@cicluz.com.br', role: 'user' };

describe('ehAdminRaiz', () => {
  /* O e-mail chega do banco como a pessoa digitou; comparar cru deixaria o
   * admin-raiz de fora do próprio privilégio por causa de uma maiúscula. */
  it('não depende de caixa nem de espaço em volta', () => {
    expect(ehAdminRaiz('  RODRIGO@CICLUZ.COM.BR ', RAIZ)).toBe(true);
    expect(ehAdminRaiz('rodrigo@cicluz.com', RAIZ)).toBe(false);
  });
});

describe('telasDe', () => {
  it('sem regra gravada, todo mundo vê tudo', () => {
    expect(telasDe(giulia, [], RAIZ)).toEqual([...Telas.TODAS_AS_TELAS]);
    expect(telasDe(jose, [], RAIZ)).toEqual([...Telas.TODAS_AS_TELAS]);
  });

  it('a linha negada tira a tela', () => {
    const vê = telasDe(giulia, [{ telaId: 'manutencao', permitido: false }], RAIZ);
    expect(vê).not.toContain('manutencao');
    expect(vê).toContain('produtos');
  });

  it('linha permitida não tira nada', () => {
    expect(telasDe(giulia, [{ telaId: 'manutencao', permitido: true }], RAIZ))
      .toContain('manutencao');
  });

  /*
   * Se uma linha pudesse desligar tela do admin-raiz, um clique errado
   * trancaria a única conta capaz de destrancar o sistema.
   */
  it('o admin-raiz ignora qualquer negativa gravada', () => {
    const regras = Telas.TODAS_AS_TELAS.map((telaId) => ({ telaId, permitido: false }));
    expect(telasDe(rodrigo, regras, RAIZ)).toEqual([...Telas.TODAS_AS_TELAS]);
  });

  /* Sem isto, desligar "Produtos" deixaria a pessoa logada e sem nenhuma tela. */
  it('tela sempre liberada não pode ser tirada de ninguém', () => {
    const vê = telasDe(giulia, [{ telaId: 'produtos', permitido: false }], RAIZ);
    expect(vê).toContain('produtos');
  });
});

describe('podeVer', () => {
  it('responde pela mesma conta de telasDe', () => {
    expect(podeVer(giulia, 'dashboard', [], RAIZ)).toBe(true);
    expect(podeVer(giulia, 'dashboard', [{ telaId: 'dashboard', permitido: false }], RAIZ)).toBe(false);
  });
});

describe('podeGerenciar', () => {
  it('o admin-raiz mexe em admin e em usuário', () => {
    expect(podeGerenciar(rodrigo, jose, RAIZ).pode).toBe(true);
    expect(podeGerenciar(rodrigo, giulia, RAIZ).pode).toBe(true);
  });

  it('ninguém mexe no admin-raiz — nem ele mesmo', () => {
    expect(podeGerenciar(jose, rodrigo, RAIZ)).toEqual({ pode: false, motivo: 'admin-raiz-intocavel' });
    expect(podeGerenciar(rodrigo, rodrigo, RAIZ)).toEqual({ pode: false, motivo: 'admin-raiz-intocavel' });
  });

  it('admin mexe em usuário comum', () => {
    expect(podeGerenciar(jose, giulia, RAIZ).pode).toBe(true);
  });

  /* Dois admins se destrancariam em par e "o Rodrigo decide os admins" viraria letra morta. */
  it('admin não mexe em outro admin', () => {
    expect(podeGerenciar(jose, outroAdmin, RAIZ)).toEqual({ pode: false, motivo: 'nao-mexe-em-admin' });
  });

  it('ninguém se auto-libera', () => {
    expect(podeGerenciar(jose, jose, RAIZ)).toEqual({ pode: false, motivo: 'nao-mexe-em-si' });
  });

  it('usuário comum não gerencia ninguém', () => {
    expect(podeGerenciar(giulia, outroAdmin, RAIZ).pode).toBe(false);
    const outroUsuario: PessoaPermissao = { id: 'g2', email: 'g2@cicluz.com.br', role: 'user' };
    expect(podeGerenciar(giulia, outroUsuario, RAIZ)).toEqual({ pode: false, motivo: 'sem-permissao' });
  });
});
