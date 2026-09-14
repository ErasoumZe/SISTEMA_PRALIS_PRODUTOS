import { describe, expect, it } from 'vitest';
import { VendasRanking } from '@pralis/shared';
import { agruparPorChave, type LinhaClassificada } from './vendas-ranking';

const linha = (chave: string | null, rotulo: string, faturamento: number, quantidade = 1): LinhaClassificada =>
  ({ chave, rotulo, faturamento, quantidade });

describe('agruparPorChave — a conta do ranking', () => {
  it('soma o faturamento por chave e ordena do maior para o menor', () => {
    const r = agruparPorChave([
      linha('padaria', 'Panificação', 100),
      linha('conf', 'Confeitaria', 300),
      linha('padaria', 'Panificação', 50),
    ]);

    expect(r.itens.map((i) => i.rotulo)).toEqual(['Confeitaria', 'Panificação']);
    expect(r.itens[0]).toMatchObject({ faturamento: 300, posicao: 1 });
    expect(r.itens[1]).toMatchObject({ faturamento: 150, posicao: 2 });
  });

  /**
   * A pontuação é a regra de bonificação, e ela vem de uma constante única —
   * espalhar `* 0.25` pela tela criaria duas verdades no dia em que o
   * percentual mudar.
   */
  it('pontua faturamento x 25%, em centavos', () => {
    const r = agruparPorChave([linha('a', 'A', 1000)]);

    expect(VendasRanking.PONTOS_POR_REAL).toBe(0.25);
    expect(r.itens[0]!.pontos).toBe(250);
    expect(r.pontosTotal).toBe(250);
  });

  it('arredonda a pontuação em centavos, sem sobra de ponto flutuante', () => {
    const r = agruparPorChave([linha('a', 'A', 10.1)]);

    expect(r.itens[0]!.pontos).toBe(2.53); // 10,10 x 0,25 = 2,525 -> 2,53
  });

  it('participação é a fatia do faturamento CLASSIFICADO mais o não classificado', () => {
    const r = agruparPorChave([
      linha('a', 'A', 750),
      linha(null, 'sem vínculo', 250),
    ]);

    // 750 de 1000 = 75%: o denominador é o período inteiro, não só o que casou
    expect(r.itens[0]!.participacao).toBe(75);
    expect(r.faturamentoTotal).toBe(1000);
  });

  /**
   * O que não casou com o cadastro NÃO vira uma fatia chamada "outros" no meio
   * do ranking: vira cobertura. Misturar os dois premiaria um setor inexistente
   * e esconderia o buraco de cadastro que causou o problema.
   */
  it('linha sem classificação fica de fora do ranking e vira cobertura', () => {
    const r = agruparPorChave([
      linha('a', 'A', 600),
      linha(null, 'CIGARRO AVULSO', 400),
    ]);

    expect(r.itens.map((i) => i.chave)).toEqual(['a']);
    expect(r.cobertura).toMatchObject({
      faturamentoClassificado: 600,
      faturamentoSemClassificacao: 400,
      percentual: 60,
      linhasSemVinculo: 1,
    });
  });

  it('período sem venda nenhuma não divide por zero', () => {
    const r = agruparPorChave([]);

    expect(r.itens).toEqual([]);
    expect(r.faturamentoTotal).toBe(0);
    expect(r.pontosTotal).toBe(0);
    expect(r.cobertura.percentual).toBe(0);
  });

  it('empate no faturamento desempata pelo rótulo, para a ordem não dançar', () => {
    const r = agruparPorChave([
      linha('z', 'Zebra', 100),
      linha('a', 'Abacaxi', 100),
    ]);

    // sem critério de desempate, duas leituras seguidas trocariam as posições
    // e a animação do painel mostraria movimento que não houve
    expect(r.itens.map((i) => i.rotulo)).toEqual(['Abacaxi', 'Zebra']);
  });

  it('soma a quantidade junto do faturamento', () => {
    const r = agruparPorChave([
      linha('a', 'A', 10, 3),
      linha('a', 'A', 20, 4),
    ]);

    expect(r.itens[0]).toMatchObject({ faturamento: 30, quantidade: 7 });
  });
});
