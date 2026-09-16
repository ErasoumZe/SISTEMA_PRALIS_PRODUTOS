import { describe, expect, it } from 'vitest';
import { montarPulso } from './vendas-pulso';

const HOJE = '2026-09-14';

describe('montarPulso — faz quanto tempo que não chega lote', () => {
  it('conta os dias entre o último dia de venda e hoje', () => {
    const r = montarPulso([
      { loja: 'TNP', tipo: 'venda_produto_dia', ultimoDia: '2026-09-08', ultimaChegada: '2026-09-08T23:40:00Z' },
    ], HOJE);

    expect(r.fontes[0]).toMatchObject({ diasSemDados: 6, atrasado: true });
    expect(r.algumAtrasado).toBe(true);
  });

  it('lote de ontem é normal, não alerta', () => {
    const r = montarPulso([
      { loja: 'TNP', tipo: 'venda_produto_dia', ultimoDia: '2026-09-13', ultimaChegada: '2026-09-13T23:40:00Z' },
    ], HOJE);

    expect(r.fontes[0]).toMatchObject({ diasSemDados: 1, atrasado: false });
    expect(r.algumAtrasado).toBe(false);
  });

  /**
   * O ALERTA olha o dia da VENDA, não o da chegada.
   *
   * Um robô que roda todo dia mas reenvia sempre o mesmo arquivo velho tem
   * `ultimaChegada` de hoje e continua sem trazer venda nova. Alertar pela
   * chegada esconderia exatamente esse defeito — o mais difícil de perceber.
   */
  it('chegada de hoje com venda velha continua sendo atraso', () => {
    const r = montarPulso([
      { loja: 'TNP', tipo: 'venda_produto_dia', ultimoDia: '2026-09-05', ultimaChegada: '2026-09-14T06:00:00Z' },
    ], HOJE);

    expect(r.fontes[0]).toMatchObject({ diasSemDados: 9, atrasado: true });
  });

  /**
   * Venda e fechamento chegam em lotes diferentes: uma pode parar sem a outra,
   * e somar as duas numa linha só esconderia metade da falha.
   */
  it('cada loja e cada tipo são avaliados separadamente', () => {
    const r = montarPulso([
      { loja: 'TNP', tipo: 'venda_produto_dia', ultimoDia: '2026-09-13', ultimaChegada: '2026-09-13T23:00:00Z' },
      { loja: 'TNP', tipo: 'fechamento_caixa_dia', ultimoDia: '2026-09-02', ultimaChegada: '2026-09-02T23:00:00Z' },
    ], HOJE);

    expect(r.fontes.map((f) => [f.tipo, f.atrasado])).toEqual([
      ['venda_produto_dia', false],
      ['fechamento_caixa_dia', true],
    ]);
    expect(r.algumAtrasado).toBe(true);
  });

  it('fonte que nunca recebeu nada aparece como atrasada, não some', () => {
    const r = montarPulso([
      { loja: 'LI', tipo: 'venda_produto_dia', ultimoDia: null, ultimaChegada: null },
    ], HOJE);

    expect(r.fontes[0]).toMatchObject({ diasSemDados: null, atrasado: true });
    expect(r.algumAtrasado).toBe(true);
  });

  it('sem fonte nenhuma não inventa alerta', () => {
    expect(montarPulso([], HOJE)).toEqual({ algumAtrasado: false, fontes: [] });
  });
});
