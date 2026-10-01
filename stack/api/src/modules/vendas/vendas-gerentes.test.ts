import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { montarRelatorioGerentes } from './vendas-gerentes.service';

describe('relatório gerentes em pontos', () => {
  const linhas = [
    { data: '2026-10-01', pdv: 'PDV 1', total: 100 },
    { data: '2026-10-01', pdv: 'PDV 1', total: 20 }, // dois operadores no mesmo PDV
    { data: '2026-10-02', pdv: 'PDV 2', total: 80 },
  ];

  it('faz uma linha por PDV, soma operadores e não envia reais', () => {
    const r = montarRelatorioGerentes('TNP', '2026-10-01', '2026-10-03', ['PDV 1', 'PDV 2'], linhas);
    expect(r.totalPontos).toBe(50);
    expect(r.series[0]?.dias).toEqual([
      { data: '2026-10-01', pontos: 30 },
      { data: '2026-10-02', pontos: null },
      { data: '2026-10-03', pontos: null },
    ]);
    expect(r.series[1]?.dias[1]?.pontos).toBe(20);
    expect(JSON.stringify(r)).not.toContain('"total":');
  });

  it('filtra PDV sem afetar a lista de opções', () => {
    const r = montarRelatorioGerentes('TNP', '2026-10-01', '2026-10-03', ['PDV 1', 'PDV 2'], linhas, 'PDV 2');
    expect(r.pdvs).toEqual(['PDV 1', 'PDV 2']);
    expect(r.series.map((s) => s.pdv)).toEqual(['PDV 2']);
    expect(r.totalPontos).toBe(20);
  });

  it('recusa PDV desconhecido e intervalo maior que 35 dias', () => {
    expect(() => montarRelatorioGerentes('TNP', '2026-10-01', '2026-10-03', ['PDV 1'], linhas, 'PDV 9')).toThrow(/não encontrado/);
    expect(() => montarRelatorioGerentes('TNP', '2026-01-01', '2026-03-01', [], [])).toThrow(/35 dias/);
  });
});
