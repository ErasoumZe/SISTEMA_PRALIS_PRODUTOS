import { describe, expect, it } from 'vitest';
import { codigoBarrasNaCriacao } from './codigo-barras-na-criacao';

describe('código de barras na criação — decisão do José em 06/10/2026', () => {
  it('sem código de barras, entra o código interno gerado', () => {
    expect(codigoBarrasNaCriacao(null, '13167')).toBe('13167');
    expect(codigoBarrasNaCriacao(undefined, '13167')).toBe('13167');
    expect(codigoBarrasNaCriacao('', '13167')).toBe('13167');
    expect(codigoBarrasNaCriacao('   ', '13167')).toBe('13167');
  });

  it('com código de barras, o que a pessoa digitou fica intocado', () => {
    expect(codigoBarrasNaCriacao('7894900060010', '13167')).toBe('7894900060010');
    // não é papel desta regra normalizar formato; ela só decide quem preenche
    expect(codigoBarrasNaCriacao(' 789490006001 ', '13167')).toBe(' 789490006001 ');
  });

  it('sem os dois, o campo continua vazio — não se inventa código', () => {
    expect(codigoBarrasNaCriacao(null, null)).toBeNull();
    expect(codigoBarrasNaCriacao(null, '')).toBeNull();
    expect(codigoBarrasNaCriacao(undefined, undefined)).toBeNull();
  });

  it('zero é código: um produto com código interno 0 não existe, mas se vier, não vira nulo calado', () => {
    expect(codigoBarrasNaCriacao(null, '0')).toBe('0');
  });
});
