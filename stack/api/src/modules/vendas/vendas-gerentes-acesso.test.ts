import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '@/types/fastify-jwt';
import { lojaGerentes, lojasGerentes } from './vendas-gerentes-acesso';

const DONO = 'rodrigo@cicluz.com.br';
const PROGRAMADOR = 'jose@exemplo.com';
const usuario = (email: string, role: 'admin' | 'user', loja: CurrentUser['loja']): CurrentUser =>
  ({ id: email, name: email, email, role, loja });

describe('lojas do Relatório Gerentes', () => {
  it('libera as duas lojas apenas para as duas contas admin nomeadas', () => {
    expect(lojasGerentes(usuario(DONO.toUpperCase(), 'admin', null), DONO, PROGRAMADOR)).toEqual(['TNP', 'LI']);
    expect(lojasGerentes(usuario(PROGRAMADOR, 'admin', null), DONO, PROGRAMADOR)).toEqual(['TNP', 'LI']);
    expect(lojasGerentes(usuario(PROGRAMADOR, 'user', 'TNP'), DONO, PROGRAMADOR)).toEqual(['TNP']);
  });

  it('prende usuários à loja e recusa admin sem vínculo nem exceção', () => {
    const li = usuario('gerente@exemplo.com', 'user', 'LI');
    expect(lojasGerentes(li, DONO, PROGRAMADOR)).toEqual(['LI']);
    expect(() => lojaGerentes(li, 'TNP', DONO, PROGRAMADOR)).toThrow(/só pode consultar/);
    expect(lojasGerentes(usuario('outro-admin@exemplo.com', 'admin', null), DONO, PROGRAMADOR)).toEqual([]);
  });
});
