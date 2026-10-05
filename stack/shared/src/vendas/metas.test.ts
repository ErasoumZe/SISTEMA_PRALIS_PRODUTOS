import { describe, expect, it } from 'vitest';
import {
  CRESCIMENTO_PADRAO, aplicarCrescimento, arredondarMeta, datasDe, diaSemanaDe,
  metaDoPeriodo, projecaoFechamento, referenciaPonderada, ritmo,
} from './metas';

/** Jul–set/2026 da TNP: três quartas, de volumes diferentes de propósito. */
const quartas = [
  { data: '2026-07-01', manha: 12_000, tarde: 12_000 },
  { data: '2026-07-08', manha: 10_000, tarde: 10_000 },
  { data: '2026-07-15', manha: 5_000, tarde: 15_000 },
];

describe('arredondarMeta', () => {
  it('arredonda a R$ 100, como o ROUND(x; -2) da planilha', () => {
    expect(arredondarMeta(22_137.43)).toBe(22_100);
    expect(arredondarMeta(22_150)).toBe(22_200);
    expect(arredondarMeta(8_925.9 * 1.15)).toBe(10_300);
  });

  it('aceita outra casa quando a planilha mudar de ideia', () => {
    expect(arredondarMeta(22_137.43, -3)).toBe(22_000);
    expect(arredondarMeta(22_137.43, 0)).toBe(22_137);
  });
});

describe('diaSemanaDe', () => {
  it('lê a data em UTC, para não escorregar um dia por fuso', () => {
    expect(diaSemanaDe('2026-10-01')).toBe(4); // quinta
    expect(diaSemanaDe('2026-10-03')).toBe(6); // sábado
    expect(diaSemanaDe('2026-10-04')).toBe(0); // domingo
  });

  it('recusa data que não existe', () => {
    expect(() => diaSemanaDe('03/10/2026')).toThrow();
  });
});

describe('referenciaPonderada', () => {
  it('pondera pelo faturamento, não pela média das porcentagens', () => {
    const [quarta] = referenciaPonderada(quartas);
    // soma manhã 27.000 / soma total 64.000 = 42,19%
    expect(quarta!.pctManha).toBeCloseTo(27_000 / 64_000, 10);
    // a média das porcentagens diárias daria (50+50+25)/3 = 41,67% — outro número
    expect(quarta!.pctManha).not.toBeCloseTo((0.5 + 0.5 + 0.25) / 3, 4);
    expect(quarta!.mediaDia).toBeCloseTo(64_000 / 3, 2);
    expect(quarta!.ocorrencias).toBe(3);
  });

  it('deixa de fora o dia da semana sem venda, em vez de assumir loja fechada', () => {
    const referencia = referenciaPonderada([
      ...quartas,
      { data: '2026-10-04', manha: 0, tarde: 0 }, // domingo fechado
    ]);
    expect(referencia.map((r) => r.diaSemana)).toEqual([3]);
  });

  it('começa a semana na segunda e joga domingo para o fim', () => {
    const referencia = referenciaPonderada([
      { data: '2026-10-04', manha: 1, tarde: 1 }, // domingo
      { data: '2026-10-03', manha: 1, tarde: 1 }, // sábado
      { data: '2026-09-28', manha: 1, tarde: 1 }, // segunda
    ]);
    expect(referencia.map((r) => r.diaSemana)).toEqual([1, 6, 0]);
  });
});

describe('aplicarCrescimento', () => {
  it('aplica os 15% e arredonda, reproduzindo a matriz entregue ao José', () => {
    const matriz = aplicarCrescimento([
      { diaSemana: 1, ocorrencias: 13, mediaDia: 19_251.29, pctManha: 0.48 },
      { diaSemana: 6, ocorrencias: 13, mediaDia: 8_925.9, pctManha: 0.649 },
    ], CRESCIMENTO_PADRAO);
    expect(matriz[0]!.meta).toBe(22_100);
    expect(matriz[0]!.metaManha).toBe(10_600);
    expect(matriz[1]!.meta).toBe(10_300);
    expect(matriz[1]!.metaManha).toBe(6_700);
    expect(matriz[1]!.metaTarde).toBe(3_600);
  });

  it('manhã mais tarde fecham exatamente a meta do dia', () => {
    const matriz = aplicarCrescimento(referenciaPonderada(quartas));
    for (const dia of matriz) {
      expect(dia.metaManha + dia.metaTarde).toBe(dia.meta);
    }
  });

  it('crescimento zero devolve a referência arredondada', () => {
    const [dia] = aplicarCrescimento([{ diaSemana: 2, ocorrencias: 5, mediaDia: 21_337.87, pctManha: 0.5 }], 0);
    expect(dia!.meta).toBe(21_300);
  });

  it('aceita crescimento negativo, que é decisão de negócio e não erro', () => {
    const [dia] = aplicarCrescimento([{ diaSemana: 2, ocorrencias: 5, mediaDia: 20_000, pctManha: 0.5 }], -0.1);
    expect(dia!.meta).toBe(18_000);
  });
});

describe('metaDoPeriodo', () => {
  const matriz = aplicarCrescimento([
    { diaSemana: 4, ocorrencias: 13, mediaDia: 21_043.5, pctManha: 0.492 },
    { diaSemana: 5, ocorrencias: 13, mediaDia: 20_761.64, pctManha: 0.535 },
    { diaSemana: 6, ocorrencias: 13, mediaDia: 8_925.9, pctManha: 0.649 },
  ]);

  it('soma os três primeiros dias de outubro, como no cartão aprovado', () => {
    const total = metaDoPeriodo(matriz, ['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(total.total).toBe(58_400);
    expect(total.manha).toBe(31_400);
    expect(total.tarde).toBe(27_000);
    expect(total.dias).toBe(3);
  });

  it('dia fora da matriz não conta e não aparece na contagem de dias abertos', () => {
    const total = metaDoPeriodo(matriz, ['2026-10-03', '2026-10-04', '2026-10-05']);
    expect(total.dias).toBe(1); // só o sábado; domingo e segunda não estão na matriz
    expect(total.total).toBe(10_300);
  });

  it('período vazio devolve zero, sem estourar', () => {
    expect(metaDoPeriodo(matriz, [])).toEqual({ total: 0, manha: 0, tarde: 0, dias: 0 });
  });
});

describe('ritmo e projeção', () => {
  it('ritmo é o realizado sobre o esperado até a data', () => {
    expect(ritmo(53_111.66, 58_400)).toBeCloseTo(0.909446, 6);
  });

  it('sem dia apurado o ritmo é nulo, nunca zero', () => {
    expect(ritmo(0, 0)).toBeNull();
    expect(ritmo(1_000, 0)).toBeNull();
  });

  it('projeta o fechamento do mês no ritmo atual, arredondado', () => {
    expect(projecaoFechamento(297_000, 29_854.21, 31_400)).toBe(282_400);
    expect(projecaoFechamento(281_000, 23_257.45, 27_000)).toBe(242_000);
  });

  it('sem esperado não projeta', () => {
    expect(projecaoFechamento(578_000, 0, 0)).toBeNull();
  });
});

describe('datasDe', () => {
  it('devolve o intervalo fechado nas duas pontas', () => {
    expect(datasDe('2026-10-01', '2026-10-03')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('atravessa a virada de mês', () => {
    expect(datasDe('2026-09-30', '2026-10-01')).toEqual(['2026-09-30', '2026-10-01']);
  });

  it('um dia só é um dia', () => {
    expect(datasDe('2026-10-01', '2026-10-01')).toEqual(['2026-10-01']);
  });
});
