import { describe, it, expect } from 'vitest';
import {
  montarDescricao,
  montarComoSeCompra,
  montarValidacaoQtd,
  calcularVVenda,
  margemPctParaFracao,
  fracaoParaMargemPct,
  normalizarGrupo,
  calcularVVendaFinal,
  resolverMargemGrupo,
  resolverSetorVenda,
} from './product.rules';

describe('R1 — descrição', () => {
  it('monta NOME + QUANTIDADE (sem zeros à direita) + MEDIDA', () => {
    expect(montarDescricao('FARINHA DE TRIGO ALVEAR', 25, 'KG')).toBe('FARINHA DE TRIGO ALVEAR 25 KG');
    expect(montarDescricao('PÃO', 25.5, 'G')).toBe('PÃO 25,5 G');
  });
  it('vazio quando tudo vazio', () => {
    expect(montarDescricao('', 0, '')).toBe('');
  });
});

/*
 * O formato `1 SACO DE25 (DESCRIÇÃO)` foi SUBSTITUÍDO em 09/09/2026 a pedido do
 * José, por um que se lê em voz alta. Os testes do formato antigo saíram daqui
 * de propósito: manter os dois seria manter duas verdades.
 * O novo está em "como se compra", mais abaixo.
 */

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

/*
 * F02 da auditoria de 08/09/2026. A tela guarda margem em % e o dominio em
 * fracao. A conversao vivia espalhada em `valor ? conta : null`, e teste de
 * verdadeiro trata 0 como vazio: uma margem de 0% escolhida a mao virava
 * "sem margem", e o preco passava a herdar a do grupo sem ninguem pedir.
 *
 * Vazio e ausencia. Zero e decisao. Sao coisas diferentes e o preco muda.
 */
describe('margem: % da tela <-> fracao do dominio', () => {
  it('ZERO por cento e uma escolha, nao ausencia', () => {
    expect(margemPctParaFracao(0)).toBe(0);
    expect(margemPctParaFracao('0')).toBe(0);
  });

  it('campo vazio e ausencia — herda a do grupo', () => {
    expect(margemPctParaFracao(null)).toBeNull();
    expect(margemPctParaFracao(undefined)).toBeNull();
    expect(margemPctParaFracao('')).toBeNull();
    expect(margemPctParaFracao('   ')).toBeNull();
  });

  it('converte por cento em fracao', () => {
    expect(margemPctParaFracao(70)).toBe(0.7);
    expect(margemPctParaFracao('7,5')).toBe(0.075); // virgula do teclado pt-BR
    expect(margemPctParaFracao(100)).toBe(1);
  });

  it('texto que nao e numero e ausencia, nunca zero', () => {
    expect(margemPctParaFracao('abc')).toBeNull();
  });

  it('a volta preserva a mesma distincao', () => {
    expect(fracaoParaMargemPct(0)).toBe(0);
    expect(fracaoParaMargemPct(null)).toBeNull();
    expect(fracaoParaMargemPct(0.7)).toBe(70);
    expect(fracaoParaMargemPct(0.075)).toBe(7.5);
  });

  it('ida e volta nao inventa nem perde a escolha', () => {
    for (const pct of [0, 7.5, 70, 133.33]) {
      expect(fracaoParaMargemPct(margemPctParaFracao(pct))).toBe(pct);
    }
    expect(fracaoParaMargemPct(margemPctParaFracao(null))).toBeNull();
  });

  /* O preco e o motivo de tudo isto: 0% e herdar dao numeros diferentes. */
  it('0% explicito NAO herda a margem do grupo', () => {
    const comum = { auto: true, custo: 10, qtCad: 1, margemGrupo: 0.5, vVendaPontual: 0, descricao: 'X' };

    expect(calcularVVenda({ ...comum, margemPontual: margemPctParaFracao(0) })).toBe(10);
    expect(calcularVVenda({ ...comum, margemPontual: margemPctParaFracao('') })).toBe(15);
  });
});

/*
 * Os nomes de grupo vindos da planilha carregam U+2060 (word joiner), que nao
 * aparece na tela. Cruzar por nome sem tirar isso nao casa NUNCA, e o motivo e
 * invisivel para quem esta olhando. Normaliza-se so a CHAVE de comparacao; o
 * texto exibido continua o oficial.
 */
describe('normalizarGrupo — chave de comparacao', () => {
  it('tira caractere invisivel, espaco duplo e caixa', () => {
    expect(normalizarGrupo('MER \u2060BOMBONIERI')).toBe('MER BOMBONIERI');
    expect(normalizarGrupo('  mer   padaria  ')).toBe('MER PADARIA');
  });

  it('vazio e nulo viram string vazia, sem estourar', () => {
    expect(normalizarGrupo(null)).toBe('');
    expect(normalizarGrupo(undefined)).toBe('');
    expect(normalizarGrupo('   ')).toBe('');
  });

  it('nome com invisivel casa com o mesmo nome sem invisivel', () => {
    expect(normalizarGrupo('MER \u2060CHOCOLATES')).toBe(normalizarGrupo('MER CHOCOLATES'));
  });
});

/*
 * Formato pedido pelo Jose em 09/09/2026, a partir do exemplo dele:
 *   queijo minas frescal kg - caixa com queijo minas frescal kg aproximadamente 20kg
 *
 * Duas mudancas: gramatura ZERO nao aparece em lugar nenhum, e a palavra
 * "aproximadamente" so entra quando a compra e aproximada.
 */
describe('descricao — gramatura zero nao aparece', () => {
  it('sem gramatura, fica so nome e medida', () => {
    expect(montarDescricao('queijo minas frescal', 0, 'KG')).toBe('QUEIJO MINAS FRESCAL KG');
    expect(montarDescricao('queijo minas frescal', '', 'KG')).toBe('QUEIJO MINAS FRESCAL KG');
    expect(montarDescricao('queijo minas frescal', null as never, 'KG')).toBe('QUEIJO MINAS FRESCAL KG');
  });

  it('com gramatura, ela aparece entre o nome e a medida', () => {
    // o formatador tira zeros a direita: 90 e nao 90,000
    expect(montarDescricao('talento', 90, 'G')).toBe('TALENTO 90 G');
    expect(montarDescricao('pao', 25.5, 'G')).toBe('PAO 25,5 G');
  });

  it('sem medida, nao sobra espaco solto', () => {
    expect(montarDescricao('pao frances', 0, '')).toBe('PAO FRANCES');
  });
});

describe('como se compra', () => {
  const desc = 'QUEIJO MINAS FRESCAL KG';

  it('aproximado escreve APROXIMADAMENTE antes da quantidade', () => {
    expect(montarComoSeCompra({
      embalagem: 'CX', cDe: 'C/', qtCad: 20, medidaCompra: 'KG',
      descricao: desc, aproximado: true,
    })).toBe('QUEIJO MINAS FRESCAL KG - CAIXA COM QUEIJO MINAS FRESCAL KG APROXIMADAMENTE 20KG');
  });

  /* Exato e o caso comum: a palavra some, o resto continua igual. */
  it('exato NAO escreve a palavra', () => {
    expect(montarComoSeCompra({
      embalagem: 'CX', cDe: 'C/', qtCad: 20, medidaCompra: 'KG',
      descricao: desc, aproximado: false,
    })).toBe('QUEIJO MINAS FRESCAL KG - CAIXA COM QUEIJO MINAS FRESCAL KG 20KG');
  });

  it('DE em vez de COM', () => {
    expect(montarComoSeCompra({
      embalagem: 'PCT', cDe: 'DE', qtCad: 12, medidaCompra: 'UN',
      descricao: 'BALA HORTELA UN', aproximado: false,
    })).toBe('BALA HORTELA UN - PACOTE DE BALA HORTELA UN 12UN');
  });

  it('sem embalagem nao monta nada', () => {
    expect(montarComoSeCompra({
      embalagem: '', cDe: 'C/', qtCad: 20, medidaCompra: 'KG', descricao: desc, aproximado: true,
    })).toBe('');
  });

  it('embalagem fora da lista aparece como veio, sem inventar nome', () => {
    expect(montarComoSeCompra({
      embalagem: 'XYZ', cDe: 'C/', qtCad: 5, medidaCompra: 'KG', descricao: desc, aproximado: false,
    })).toContain('XYZ COM');
  });
});
