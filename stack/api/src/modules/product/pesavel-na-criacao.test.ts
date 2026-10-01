import { describe, expect, it } from 'vitest';
import { pesavelNaCriacao } from './pesavel-na-criacao';

describe('pesável na criação', () => {
  it('começa em Não quando o cliente omite ou envia nulo', () => {
    expect(pesavelNaCriacao(undefined)).toBe('N');
    expect(pesavelNaCriacao(null)).toBe('N');
  });

  it('respeita a escolha explícita, inclusive Sim', () => {
    expect(pesavelNaCriacao('S')).toBe('S');
    expect(pesavelNaCriacao('N')).toBe('N');
  });
});
