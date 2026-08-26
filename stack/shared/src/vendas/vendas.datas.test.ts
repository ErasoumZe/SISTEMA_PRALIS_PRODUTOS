import { describe, expect, it } from 'vitest';
import { dataLocalISO, diasAntes } from './vendas.datas';

describe('dataLocalISO', () => {
  it('usa o dia LOCAL, não o UTC — 22h em Brasília ainda é hoje', () => {
    // 26/08/2026 às 22:00 em UTC-3 = 27/08 às 01:00 em UTC.
    // toISOString() diria 2026-08-27; o usuário está vendo 26.
    const noite = new Date(2026, 7, 26, 22, 0, 0);

    expect(dataLocalISO(noite)).toBe('2026-08-26');
  });

  it('a virada do mês às 23h não pula para o mês seguinte', () => {
    const viradaDeMes = new Date(2026, 6, 31, 23, 30, 0);

    expect(dataLocalISO(viradaDeMes)).toBe('2026-07-31');
  });

  it('zero à esquerda em mês e dia', () => {
    expect(dataLocalISO(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });

  it('meia-noite e meio-dia dão o mesmo dia', () => {
    expect(dataLocalISO(new Date(2026, 7, 26, 0, 0, 0))).toBe('2026-08-26');
    expect(dataLocalISO(new Date(2026, 7, 26, 12, 0, 0))).toBe('2026-08-26');
  });
});

describe('diasAntes', () => {
  it('anda para trás sem depender de milissegundos', () => {
    expect(dataLocalISO(diasAntes(new Date(2026, 7, 26, 22, 0, 0), 29))).toBe('2026-07-28');
  });

  it('atravessa a virada de mês corretamente', () => {
    expect(dataLocalISO(diasAntes(new Date(2026, 2, 3, 10, 0, 0), 5))).toBe('2026-02-26');
  });

  it('atravessa a virada de ano', () => {
    expect(dataLocalISO(diasAntes(new Date(2026, 0, 2, 10, 0, 0), 5))).toBe('2025-12-28');
  });

  it('não altera a data recebida', () => {
    const original = new Date(2026, 7, 26, 10, 0, 0);
    diasAntes(original, 10);

    expect(dataLocalISO(original)).toBe('2026-08-26');
  });
});
