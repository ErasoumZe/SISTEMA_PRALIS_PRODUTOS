import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { calcularMetaTnpDia } from '../../../../shared/src/vendas/metas-planilha';
import { montarMetasPlanilhaTnp } from './metas.service';

const parametros = {
  ajusteDia: 0, crescimentoMes: 0, pctManha: 0.48,
  modo: 'arredondada' as const, casasArredondamento: -2,
};
const meta = (data: string, base: number | null) => ({
  data, meta: calcularMetaTnpDia(data, base, parametros),
});

describe('cartões por data da planilha TNP', () => {
  it('soma dias reais, fecha os três cartões e ignora domingo fechado', () => {
    const fonte = {
      lidoEm: '2026-10-09T12:00:00.000Z',
      porData: new Map([
        ['2026-10-10', meta('2026-10-10', 10_050)],
        ['2026-10-11', meta('2026-10-11', 50_000)],
        ['2026-10-12', meta('2026-10-12', 20_000)],
      ]),
    };
    const resultado = montarMetasPlanilhaTnp(
      { inicio: '2026-10-10', fim: '2026-10-12' }, fonte,
      [{ data: '2026-10-10', manha: 4_000, tarde: 4_500 }], true, 0.25,
    );
    expect(resultado.regra).toBe('planilha_364_dias');
    expect(resultado.dias[1]).toMatchObject({ data: '2026-10-11', aberto: false, meta: 0 });
    expect(resultado.turnos.total.reais?.metaPeriodo).toBe(30_100);
    expect(resultado.turnos.manha.reais?.metaPeriodo).toBe(14_400);
    expect(resultado.turnos.tarde.reais?.metaPeriodo).toBe(15_700);
    expect(resultado.turnos.manha.metaPeriodo + resultado.turnos.tarde.metaPeriodo)
      .toBe(resultado.turnos.total.metaPeriodo);
    expect(resultado.turnos.total.reais?.metaAteAgora).toBe(10_100);
    expect(resultado.fonte.diasApurados).toBe(1);
    expect(resultado.fonte.diasSemFechamento).toEqual([]);
  });

  it('não incorpora dia sem base histórica ao objetivo', () => {
    const fonte = {
      lidoEm: '2026-10-09T12:00:00.000Z',
      porData: new Map([['2027-10-20', meta('2027-10-20', null)]]),
    };
    const resultado = montarMetasPlanilhaTnp(
      { inicio: '2027-10-20', fim: '2027-10-20' }, fonte, [], false, 0.25,
    );
    expect(resultado.fonte.diasSemReferencia).toEqual(['2027-10-20']);
    expect(resultado.fonte.diasAbertos).toBe(0);
    expect(resultado.turnos.total.ritmo).toBeNull();
  });
});
