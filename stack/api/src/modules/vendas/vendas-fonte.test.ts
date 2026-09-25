import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { escolherFonte, preencherLacunas } from './vendas-fonte';

describe('preencherLacunas', () => {
  it('hora sem venda entra como zero — o gráfico não inventa ponte', () => {
    const r = preencherLacunas([
      { t: '2026-09-25T08:00', total: 10, numeroVendas: 1 },
      { t: '2026-09-25T11:00', total: 5, numeroVendas: 1 },
    ], 'hora');
    expect(r.map((p) => p.t)).toEqual(['2026-09-25T08:00', '2026-09-25T09:00', '2026-09-25T10:00', '2026-09-25T11:00']);
    expect(r[1]).toEqual({ t: '2026-09-25T09:00', total: 0, numeroVendas: 0 });
  });

  it('dia sem venda também, atravessando a virada do mês', () => {
    const r = preencherLacunas([
      { t: '2026-09-29', total: 1, numeroVendas: 1 },
      { t: '2026-10-02', total: 1, numeroVendas: 1 },
    ], 'dia');
    expect(r.map((p) => p.t)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });
});

/*
 * A regra que decide se hora, PDV e setor valem num recorte: os cupons só
 * são a fonte quando cobrem o período INTEIRO. Começando antes do primeiro
 * cupom, os dias anteriores sairiam zerados sem aviso.
 */
describe('escolherFonte', () => {
  it('período coberto pelos cupons usa os itens, com hora e PDV', () => {
    const f = escolherFonte('2026-09-24', '2026-09-25', { hi: '17:00', hf: '19:00', pdv: '7' }, '2026-09-24');
    expect(f).toMatchObject({ tipo: 'itens', inicioTs: '2026-09-24 17:00', fimTs: '2026-09-25 19:00', dispositivo: '7', ignorados: [] });
  });

  it('sem hora, o dia inteiro: 00:00 a 23:59', () => {
    const f = escolherFonte('2026-09-24', '2026-09-24', {}, '2026-09-01');
    expect(f).toMatchObject({ tipo: 'itens', inicioTs: '2026-09-24 00:00', fimTs: '2026-09-24 23:59' });
  });

  it('período começando antes do primeiro cupom cai no diário e DIZ o que ignorou', () => {
    const f = escolherFonte('2026-09-01', '2026-09-25', { hi: '17:00', pdv: '7' }, '2026-09-24');
    expect(f).toMatchObject({ tipo: 'diario', dispositivo: null, ignorados: ['hora', 'pdv'] });
  });

  it('loja que nunca mandou cupom usa o diário', () => {
    expect(escolherFonte('2026-09-24', '2026-09-24', {}, null).tipo).toBe('diario');
  });

  it('hora malformada é descartada, não vira SQL', () => {
    const f = escolherFonte('2026-09-24', '2026-09-24', { hi: '25h' }, '2026-09-24');
    expect(f.inicioTs).toBe('2026-09-24 00:00');
  });
});
