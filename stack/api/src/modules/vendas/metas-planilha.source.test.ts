import { describe, expect, it } from 'vitest';
import { interpretarMetasTnp } from './metas-planilha.source';

const linha = (dataSerial: number, base: number, pctManha: number, cq: number, dl: number, eg: number) => {
  const ranges: Array<{ values: unknown[][] }> = Array.from({ length: 10 }, () => ({ values: [] }));
  for (const [indice, valor] of [
    [0, dataSerial], [1, base], [2, 0], [3, 0], [4, pctManha], [5, cq], [6, dl], [7, eg],
  ] as const) ranges[indice]!.values[0] = [valor];
  ranges[8]!.values[0] = ['ANO ANT.+CRESC. ARRED'];
  ranges[9]!.values[0] = [-2];
  return ranges;
};
const serial = (data: string) => (Date.parse(`${data}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;

describe('leitura segura da planilha de metas TNP', () => {
  it('confere CQ/DL/EG da terça e entrega tarde residual', () => {
    const dados = interpretarMetasTnp(linha(serial('2026-10-06'), 23_463.49, 0.48, 23_500, 11_300, 12_200), '2026-10-09');
    const meta = dados.porData.get('2026-10-06')?.meta;
    expect(meta?.estado).toBe('calculada');
    if (meta?.estado === 'calculada') expect(meta.valores.tarde).toBe(12_200);
  });

  it('domingo fechado zera a meta mesmo quando CQ é positivo', () => {
    const dados = interpretarMetasTnp(linha(serial('2026-12-20'), 3_100, 0, 3_100, 0, 0), '2026-10-09');
    expect(dados.porData.get('2026-12-20')?.meta).toMatchObject({ estado: 'domingo_fechado', total: 0 });
  });

  it('não valida como zero o histórico de uma data que ainda não aconteceu', () => {
    const dados = interpretarMetasTnp(linha(serial('2027-10-20'), 0, 0.48, 0, 0, 0), '2026-10-09');
    expect(dados.porData.get('2027-10-20')?.meta).toMatchObject({ estado: 'sem_referencia' });
  });

  it('falha fechado se a fórmula da planilha mudar', () => {
    expect(() => interpretarMetasTnp(
      linha(serial('2026-10-06'), 23_463.49, 0.48, 23_400, 11_300, 12_200), '2026-10-09',
    )).toThrow(/linha 34, coluna CQ/);
  });
});
