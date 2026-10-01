import { describe, expect, it } from 'vitest';
import { diasNoMes, mesAtualSaoPaulo, periodoGerentes, semanasDoMes } from './vendas-gerentes.periodo';

describe('períodos do relatório gerentes', () => {
  it('começa outubro de 2026 na segunda anterior e termina no sábado', () => {
    expect(semanasDoMes('2026-10')[0]).toEqual({ inicio: '2026-09-28', fim: '2026-10-03' });
    expect(semanasDoMes('2026-10')[1]).toEqual({ inicio: '2026-10-05', fim: '2026-10-10' });
  });

  it('não inclui domingo em semana gerencial', () => {
    expect(semanasDoMes('2026-11')[0]).toEqual({ inicio: '2026-11-02', fim: '2026-11-07' });
  });

  it('valida o dia conforme o mês, inclusive ano bissexto', () => {
    expect(diasNoMes('2028-02')).toBe(29);
    expect(periodoGerentes('2028-02', 'dia', '29')).toEqual({ inicio: '2028-02-29', fim: '2028-02-29' });
    expect(() => periodoGerentes('2026-02', 'dia', '29')).toThrow(/1 e 28/);
    expect(() => periodoGerentes('2026-04', 'dia', '31')).toThrow(/1 e 30/);
    expect(() => periodoGerentes('2026-10', 'dia', 'abc')).toThrow(/Informe um dia/);
  });

  it('mantém o mês de São Paulo na virada UTC', () => {
    expect(mesAtualSaoPaulo(new Date('2026-11-01T01:00:00Z'))).toBe('2026-10');
  });
});
