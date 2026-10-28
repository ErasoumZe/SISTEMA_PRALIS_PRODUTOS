import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { calcularMetaTnpDia } from '../../../../shared/src/vendas/metas-planilha';
import { MetasService, montarMetasPlanilhaTnp } from './metas.service';

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

  it('dia de fechamento incompleto entra pelos itens, com o turno pela hora', async () => {
    const fonte = {
      lidoEm: '2026-10-09T12:00:00.000Z',
      porData: new Map([
        ['2026-10-26', meta('2026-10-26', 20_000)],
        ['2026-10-27', meta('2026-10-27', 20_000)],
      ]),
    };
    const repositorio = {
      temMetasPlanilhaTnp: async () => true,
      metasPlanilhaTnp: async () => fonte,
      vendaPorTurno: async () => [
        { data: '2026-10-26', manha: 9_000, tarde: 10_000 },
        { data: '2026-10-27', manha: 69.5, tarde: 72.44 },
      ],
      diasFechamentoIncompleto: async () => ['2026-10-27'],
      vendaPorTurnoItens: async (_loja: string, dias: string[]) =>
        dias.map((data) => ({ data, manha: 10_500, tarde: 11_532.38 })),
    };
    const fatores = { fatorEm: async () => 0.25 };
    const resultado = await new MetasService(repositorio as never, fatores as never)
      .consultar('TNP', { inicio: '2026-10-26', fim: '2026-10-27' }, true);

    expect(resultado.turnos.manha.reais?.realizado).toBe(19_500);
    expect(resultado.turnos.tarde.reais?.realizado).toBe(21_532.38);
    expect(resultado.fonte.diasApurados).toBe(2);
    expect(resultado.fonte.diasFechamentoIncompleto).toEqual(['2026-10-27']);
    expect(resultado.dias[1]).toMatchObject({ data: '2026-10-27', manha: 2_625, tarde: 2_883.1 });
  });

  it('dia de fechamento incompleto sem itens fica fora do realizado e é apontado à parte', async () => {
    const fonte = {
      lidoEm: '2026-10-09T12:00:00.000Z',
      porData: new Map([
        ['2026-10-26', meta('2026-10-26', 20_000)],
        ['2026-10-27', meta('2026-10-27', 20_000)],
      ]),
    };
    const repositorio = {
      temMetasPlanilhaTnp: async () => true,
      metasPlanilhaTnp: async () => fonte,
      // 27/10 chegou como em 28/10/2026: duas vendas por turno, R$ 142 no dia
      vendaPorTurno: async () => [
        { data: '2026-10-26', manha: 9_000, tarde: 10_000 },
        { data: '2026-10-27', manha: 69.5, tarde: 72.44 },
      ],
      diasFechamentoIncompleto: async () => ['2026-10-27'],
      // antes dos cupons não há itens para trocar
      vendaPorTurnoItens: async () => [],
    };
    const fatores = { fatorEm: async () => 0.25 };
    const resultado = await new MetasService(repositorio as never, fatores as never)
      .consultar('TNP', { inicio: '2026-10-26', fim: '2026-10-27' }, true);

    expect(resultado.turnos.total.reais?.realizado).toBe(19_000);
    expect(resultado.fonte.diasApurados).toBe(1);
    expect(resultado.fonte.diasFechamentoIncompleto).toEqual(['2026-10-27']);
    expect(resultado.fonte.diasSemFechamento).toEqual([]);
    expect(resultado.dias[1]).toMatchObject({ data: '2026-10-27', realizado: 0 });
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
