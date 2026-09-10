import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { esperaEmMinutos, TETO_TENTATIVAS } from './reenvio.service';

/**
 * A curva de espera decide se o reenvio ajuda ou atrapalha. Sem ela, uma aba
 * renomeada faria a rotina brigar com o Google a cada rodada, queimando cota
 * por um erro que nao passa sozinho.
 */
describe('espera entre tentativas', () => {
  it('a primeira tentativa nao espera', () => {
    expect(esperaEmMinutos(0)).toBe(1);
    expect(esperaEmMinutos(1)).toBe(1);
  });

  it('dobra a cada tentativa: falha passageira volta rapido', () => {
    expect(esperaEmMinutos(2)).toBe(2);
    expect(esperaEmMinutos(3)).toBe(4);
    expect(esperaEmMinutos(4)).toBe(8);
  });

  it('para de crescer numa hora: nao adianta esperar um dia', () => {
    expect(esperaEmMinutos(10)).toBe(60);
    expect(esperaEmMinutos(99)).toBe(60);
  });

  it('o teto de tentativas existe e e finito', () => {
    expect(TETO_TENTATIVAS).toBeGreaterThan(3);
    expect(Number.isFinite(TETO_TENTATIVAS)).toBe(true);
  });
});
