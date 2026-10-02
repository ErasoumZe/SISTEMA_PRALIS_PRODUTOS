import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { montarRelatorioGerentes } from './vendas-gerentes.service';

describe('relatório gerentes em pontos', () => {
  const linhas = [
    { data: '2026-10-01', pdv: 'PDV 1', dispositivoIdErp: '7', total: 100, numeroVendas: 2 },
    { data: '2026-10-01', pdv: 'PDV 1', dispositivoIdErp: '7', total: 20, numeroVendas: 1 }, // dois operadores no mesmo PDV
    { data: '2026-10-02', pdv: 'PDV 2', dispositivoIdErp: '8', total: 80, numeroVendas: 4 },
  ];

  it('faz uma linha por PDV, soma operadores e não envia reais', () => {
    const r = montarRelatorioGerentes('TNP', '2026-10-01', '2026-10-03', ['PDV 1', 'PDV 2'], linhas);
    expect(r.totalPontos).toBe(50);
    expect(r.series[0]?.dias).toEqual([
      { data: '2026-10-01', pontos: 30, faturamento: null, numeroVendas: 3, ticketMedio: null, quantidade: null, vendasComItens: null },
      { data: '2026-10-02', pontos: null, faturamento: null, numeroVendas: null, ticketMedio: null, quantidade: null, vendasComItens: null },
      { data: '2026-10-03', pontos: null, faturamento: null, numeroVendas: null, ticketMedio: null, quantidade: null, vendasComItens: null },
    ]);
    expect(r.series[1]?.dias[1]?.pontos).toBe(20);
    expect(JSON.stringify(r)).not.toContain('"total":');
  });

  it('mostra metricas apenas com fonte valida e sigilo aplicado na resposta', () => {
    const itens = [{ data: '2026-10-01', dispositivoIdErp: '7', quantidade: 5.25, vendas: 3 }];
    const admin = montarRelatorioGerentes('TNP', '2026-10-01', '2026-10-03', ['PDV 1', 'PDV 2'], linhas, undefined, itens, true);
    expect(admin.series[0]?.dias[0]).toMatchObject({ pontos: 30, faturamento: 120, numeroVendas: 3, ticketMedio: 40, quantidade: 5.25, vendasComItens: 3 });
    expect(admin.series[1]?.dias[1]).toMatchObject({ faturamento: 80, numeroVendas: 4, ticketMedio: 20, quantidade: null });
    const gerente = montarRelatorioGerentes('TNP', '2026-10-01', '2026-10-03', ['PDV 1', 'PDV 2'], linhas, undefined, itens);
    expect(gerente.series[0]?.dias[0]).toMatchObject({ faturamento: null, ticketMedio: null, quantidade: 5.25 });
  });

  it('nao atribui quantidade se o dispositivo do fechamento estiver ausente ou ambiguo', () => {
    const itens = [{ data: '2026-10-01', dispositivoIdErp: '7', quantidade: 5, vendas: 2 }];
    const semId = [...linhas, { data: '2026-10-01', pdv: 'PDV 1', dispositivoIdErp: '', total: 10, numeroVendas: 1 }];
    const ambiguo = [...linhas, { data: '2026-10-01', pdv: 'PDV 2', dispositivoIdErp: '7', total: 10, numeroVendas: 1 }];
    expect(montarRelatorioGerentes('TNP', '2026-10-01', '2026-10-01', ['PDV 1'], semId, undefined, itens).series[0]?.dias[0]?.quantidade).toBeNull();
    expect(montarRelatorioGerentes('TNP', '2026-10-01', '2026-10-01', ['PDV 1', 'PDV 2'], ambiguo, undefined, itens).series[0]?.dias[0]?.quantidade).toBeNull();
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
