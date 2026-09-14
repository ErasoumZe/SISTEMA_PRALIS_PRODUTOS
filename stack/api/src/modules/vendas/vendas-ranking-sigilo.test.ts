import { describe, expect, it } from 'vitest';
import { semDinheiro, podeVerDinheiro } from './vendas-ranking-sigilo';
import type { VendasRanking } from '@pralis/shared';

const resposta = (): VendasRanking.VendasRanking => ({
  loja: 'TNP',
  periodo: { inicio: '2026-03-01', fim: '2026-03-31' },
  dimensao: 'setor',
  campo: 'setorEstoque',
  faturamentoTotal: 30000,
  pontosTotal: 7500,
  itens: [
    { chave: 'pan', rotulo: 'PROD. - PANIFICAÇÃO', faturamento: 18000, quantidade: 120, numeroVendas: null, participacao: 60, pontos: 4500, posicao: 1 },
    { chave: 'conf', rotulo: 'PROD. - CONFEITARIA', faturamento: 12000, quantidade: 80, numeroVendas: null, participacao: 40, pontos: 3000, posicao: 2 },
  ],
  cobertura: {
    faturamentoClassificado: 30000,
    faturamentoSemClassificacao: 2000,
    percentual: 93.75,
    linhasSemVinculo: 3,
  },
});

/**
 * O painel de setores fica num monitor, à vista de colaboradores. Esconder a
 * coluna no HTML não esconderia nada: o número continuaria viajando na resposta,
 * e qualquer um o lê abrindo o navegador. Quem não pode ver, não recebe.
 */
describe('semDinheiro — o faturamento não sai do servidor', () => {
  it('zera todo campo de dinheiro, em todos os níveis da resposta', () => {
    const r = semDinheiro(resposta());

    expect(r.faturamentoTotal).toBeNull();
    expect(r.itens.every((i) => i.faturamento === null)).toBe(true);
    expect(r.cobertura.faturamentoClassificado).toBeNull();
    expect(r.cobertura.faturamentoSemClassificacao).toBeNull();
  });

  it('não sobra nenhum valor em reais em lugar nenhum do JSON', () => {
    const texto = JSON.stringify(semDinheiro(resposta()));

    // os valores originais, em qualquer formato que o JSON pudesse escrever
    for (const valor of [30000, 18000, 12000, 2000]) {
      expect(texto).not.toContain(String(valor));
    }
  });

  it('preserva o que a tela PRECISA: ordem, rótulo, pontos e proporção', () => {
    const r = semDinheiro(resposta());

    expect(r.itens.map((i) => [i.rotulo, i.posicao, i.pontos, i.participacao])).toEqual([
      ['PROD. - PANIFICAÇÃO', 1, 4500, 60],
      ['PROD. - CONFEITARIA', 2, 3000, 40],
    ]);
    expect(r.pontosTotal).toBe(7500);
    // a cobertura em PERCENTUAL fica: é proporção, não revela valor
    expect(r.cobertura.percentual).toBe(93.75);
    expect(r.cobertura.linhasSemVinculo).toBe(3);
  });
});

describe('podeVerDinheiro — quem enxerga faturamento', () => {
  it('administrador vê', () => {
    expect(podeVerDinheiro({ role: 'admin' })).toBe(true);
  });

  it('colaborador comum NÃO vê', () => {
    expect(podeVerDinheiro({ role: 'user' })).toBe(false);
  });

  /**
   * Sem usuário não é "todo mundo": é ninguém. Errar para o lado de esconder
   * é o único erro aceitável aqui.
   */
  it('sem usuário, não vê', () => {
    expect(podeVerDinheiro(undefined)).toBe(false);
    expect(podeVerDinheiro({} as never)).toBe(false);
  });
});
