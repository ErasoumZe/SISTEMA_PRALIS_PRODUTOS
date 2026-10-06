import { describe, expect, it } from 'vitest';
import {
  STATUS_INICIAL_DA_LISTA, filtrarPorStatus, lerFiltroStatus, passaNoFiltroStatus, statusFoiAlterado,
} from './product-listagem';

const produto = (id: string, status: string | null) => ({ id, status });

describe('como as listas de produto abrem — decisão do José em 06/10/2026', () => {
  it('toda lista abre em ATIVO', () => {
    expect(STATUS_INICIAL_DA_LISTA).toBe('ativo');
  });

  it('sem nada na URL, vale o padrão; o atalho de inativos continua valendo', () => {
    expect(lerFiltroStatus(undefined)).toBe('ativo');
    expect(lerFiltroStatus('')).toBe('ativo');
    expect(lerFiltroStatus('ativo')).toBe('ativo');
    expect(lerFiltroStatus('inativo')).toBe('inativo');
  });

  it('`todos` na URL pede o catálogo inteiro, de propósito', () => {
    expect(lerFiltroStatus('todos')).toBeNull();
    expect(lerFiltroStatus('TODOS')).toBeNull();
  });

  it('valor estranho na URL não abre o catálogo inteiro por acidente', () => {
    expect(lerFiltroStatus('unificado')).toBe('ativo');
    expect(lerFiltroStatus('qualquer coisa')).toBe('ativo');
    expect(lerFiltroStatus(null)).toBe('ativo');
  });

  it('filtra pelo status pedido, e `null` deixa tudo passar', () => {
    const lista = [produto('a', 'ativo'), produto('b', 'inativo'), produto('c', 'ativo')];
    expect(filtrarPorStatus(lista, 'ativo').map((p) => p.id)).toEqual(['a', 'c']);
    expect(filtrarPorStatus(lista, 'inativo').map((p) => p.id)).toEqual(['b']);
    expect(filtrarPorStatus(lista, null).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('produto sem status não passa por ativo — não se inventa estado que o cadastro não diz', () => {
    expect(passaNoFiltroStatus(null, 'ativo')).toBe(false);
    expect(passaNoFiltroStatus(undefined, 'ativo')).toBe(false);
    expect(passaNoFiltroStatus(null, null)).toBe(true);
  });

  it('o contador de filtros só acende quando a pessoa sai do padrão', () => {
    expect(statusFoiAlterado('ativo')).toBe(false);
    expect(statusFoiAlterado('inativo')).toBe(true);
    expect(statusFoiAlterado(null)).toBe(true);
  });

  it('filtrar não mexe na lista original', () => {
    const lista = [produto('a', 'ativo'), produto('b', 'inativo')];
    filtrarPorStatus(lista, 'ativo');
    expect(lista).toHaveLength(2);
  });
});
