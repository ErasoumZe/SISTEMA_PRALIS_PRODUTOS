import { describe, it, expect } from 'vitest';
import {
  montarDescricao,
  montarComoSeCompra,
  montarValidacaoQtd,
  calcularVVenda,
  calcularVVendaFinal,
  resolverMargemGrupo,
  resolverSetorVenda,
} from './product.rules';

describe('R1 — descrição', () => {
  it('monta NOME + QUANTIDADE(3 casas) + MEDIDA (= célula H12 da planilha)', () => {
    expect(montarDescricao('FARINHA DE TRIGO ALVEAR', 25, 'KG')).toBe('FARINHA DE TRIGO ALVEAR 25,000 KG');
  });
  it('vazio quando tudo vazio', () => {
    expect(montarDescricao('', 0, '')).toBe('');
  });
});

describe('R2 — como se compra', () => {
  it('DE inclui qtCad colado', () => {
    expect(montarComoSeCompra('SACO', 'DE', 25, 'FARINHA DE TRIGO ALVEAR 25,000 KG')).toBe(
      '1 SACO DE25 (FARINHA DE TRIGO ALVEAR 25,000 KG)',
    );
  });
  it('C/ sem qtCad', () => {
    expect(montarComoSeCompra('LT', 'C/', 10, 'TESTE 25,000 KG')).toBe('1 LT C/ (TESTE 25,000 KG)');
  });
});

describe('R3 — validação de quantidade', () => {
  it('usa a quantidade informada (= célula U12)', () => {
    expect(montarValidacaoQtd('FARINHA DE TRIGO ALVEAR 25,000 KG', 'EXATOS', 25000, 'G')).toBe(
      'DENTRO DA EMB (FARINHA DE TRIGO ALVEAR 25,000 KG) TEM EXATOS 25000 G',
    );
  });
});

describe('R4 — valor de venda', () => {
  it('margem 0 → custo unitário (= AO11, custo 10 ÷ qtCad 10 = 1,00)', () => {
    expect(
      calcularVVenda({ auto: true, custo: 10, qtCad: 10, margemPontual: null, margemGrupo: 0, vVendaPontual: 0, descricao: 'X' }),
    ).toBe(1);
  });
  it('auto=false → usa venda pontual (= AO12 = 0)', () => {
    expect(calcularVVenda({ auto: false, custo: 105.99, qtCad: 25, margemPontual: null, margemGrupo: 0, vVendaPontual: 0 })).toBe(0);
  });
  it('margem 0,30 sobre custo unitário (custo 100 ÷ qtCad 2 = 50 → 65,00)', () => {
    expect(
      calcularVVenda({ auto: true, custo: 100, qtCad: 2, margemPontual: 0.3, margemGrupo: 0, vVendaPontual: 0, descricao: 'X' }),
    ).toBe(65);
  });
  it('margem pontual tem prioridade sobre a do grupo', () => {
    expect(
      calcularVVenda({ auto: true, custo: 10, qtCad: 1, margemPontual: 0.5, margemGrupo: 0.1, vVendaPontual: 0, descricao: 'X' }),
    ).toBe(15);
  });
  it('sem descrição → 0', () => {
    expect(calcularVVenda({ auto: true, custo: 100, qtCad: 1, margemPontual: null, margemGrupo: 0.5, vVendaPontual: 0, descricao: '' })).toBe(0);
  });
});

describe('R5 — valor de venda final (promoção)', () => {
  const seg14 = new Date(2026, 5, 15, 14, 0); // segunda 14:00
  const seg18 = new Date(2026, 5, 15, 18, 0);
  const promoDesc = { tipo: 'desconto' as const, descontoPct: 0.2, horaInicio: '12:00', horaFim: '15:00', dias: [true, true, true, true, true, false, false] };

  it('aplica desconto dentro da janela (100 → 80)', () => {
    expect(calcularVVendaFinal({ vVenda: 100, agora: seg14, promocoes: [promoDesc] })).toBe(80);
  });
  it('fora do horário → preço normal', () => {
    expect(calcularVVendaFinal({ vVenda: 100, agora: seg18, promocoes: [promoDesc] })).toBe(100);
  });
  it('promoção de valor fixo dentro da janela', () => {
    expect(
      calcularVVendaFinal({ vVenda: 100, agora: seg14, promocoes: [{ tipo: 'valor', valor: 75, horaInicio: '12:00', horaFim: '15:00', dias: [true, true, true, true, true, false, false] }] }),
    ).toBe(75);
  });
  it('sem promoção → preço normal', () => {
    expect(calcularVVendaFinal({ vVenda: 42, agora: seg14, promocoes: [] })).toBe(42);
  });
});

describe('R6 — lookups', () => {
  it('margem do grupo', () => {
    expect(resolverMargemGrupo('FARINHAS', [{ nome: 'FARINHAS', margem: 0.25 }])).toBe(0.25);
  });
  it('setor de venda', () => {
    expect(resolverSetorVenda('BALCÃO', [{ codigo: 'BALCÃO', setor: 'LJ - VITRINES' }])).toBe('LJ - VITRINES');
  });
});
