import { describe, expect, it } from 'vitest';
import { arredondarComoSheets, calcularMetaPlanilha, calcularMetaTnpDia, dataBase364DiasAntes } from './metas-planilha';

const padrao = {
  ajusteDia: 0, crescimentoMes: 0, pctManha: 0.48,
  modo: 'arredondada' as const, casasArredondamento: -2,
};

describe('meta diária baseada na planilha TNP', () => {
  it('compara a data de 06/10/2026 com 07/10/2025, não com 06/10/2025', () => {
    expect(dataBase364DiasAntes('2026-10-06')).toBe('2025-10-07');
    expect(dataBase364DiasAntes('2026-01-01')).toBe('2025-01-02');
    expect(() => dataBase364DiasAntes('2026-02-30')).toThrow();
  });

  it('reproduz CQ e DL da linha 313; tarde fecha o card total', () => {
    const meta = calcularMetaPlanilha(23_463.49, padrao);
    expect(meta.total).toBe(23_500);
    expect(meta.manha).toBe(11_300);
    expect(meta.tarde).toBe(12_200);
    expect(meta.manha + meta.tarde).toBe(meta.total);
  });

  it('aplica BA antes de BB e divide a base antes do arredondamento do total', () => {
    const meta = calcularMetaPlanilha(20_000, {
      ...padrao, ajusteDia: -0.25, crescimentoMes: 0.10, pctManha: 0.63,
    });
    expect(meta.ajustada).toBe(15_000);
    expect(meta.crescida).toBe(16_500);
    expect(meta.total).toBe(16_500);
    expect(meta.manha).toBe(10_400);
    expect(meta.tarde).toBe(6_100);
  });

  it('não troca ROUND do Sheets pelo empate-para-par do Python', () => {
    expect(arredondarComoSheets(15_250, -2)).toBe(15_300);
    expect(arredondarComoSheets(-15_250, -2)).toBe(-15_300);
  });

  it('expõe a divergência de EG sem adulterar CQ, DL ou vendas reais', () => {
    const meta = calcularMetaPlanilha(10_050, { ...padrao, pctManha: 0.5 });
    expect(meta.total).toBe(10_100);
    expect(meta.manha).toBe(5_000);
    expect(meta.tarde).toBe(5_100);
    expect(meta.tardePlanilha).toBe(5_000);
    expect(meta.diferencaTardePlanilha).toBe(100);
  });

  it('respeita os três modos do seletor CN5', () => {
    expect(calcularMetaPlanilha(101.23, { ...padrao, modo: 'ajustada', ajusteDia: 0.1 }).total).toBe(111.35);
    expect(calcularMetaPlanilha(101.23, { ...padrao, modo: 'crescida', crescimentoMes: 0.1 }).total).toBe(111.35);
  });

  it('zera domingo fechado, inclusive o 20/12/2026 que a planilha deixa em R$ 3.100', () => {
    expect(calcularMetaTnpDia('2026-12-20', 3_100, { ...padrao, pctManha: 0 })).toEqual({
      estado: 'domingo_fechado', data: '2026-12-20', total: 0, manha: 0, tarde: 0,
    });
  });

  it('separa falta de base histórica de meta real igual a zero', () => {
    expect(calcularMetaTnpDia('2026-10-06', null, padrao)).toEqual({
      estado: 'sem_referencia', data: '2026-10-06', dataBase: '2025-10-07',
    });
    const comBaseZero = calcularMetaTnpDia('2026-10-06', 0, padrao);
    expect(comBaseZero.estado).toBe('calculada');
    if (comBaseZero.estado === 'calculada') expect(comBaseZero.valores.total).toBe(0);
  });
});
