import { VendasRanking } from '@pralis/shared';

/**
 * A conta do ranking, separada de banco e de HTTP.
 *
 * Aqui só entra linha já classificada — quem descobriu a chave foi outro. Isso
 * é o que permite a MESMA conta servir produto, grupo, setor e PDV sem quatro
 * cópias, e ser testada sem subir Postgres.
 */

/** Uma linha de venda já reduzida ao que o ranking precisa. */
export interface LinhaClassificada {
  /** `null` quando a venda não casou com produto do cadastro. */
  chave: string | null;
  rotulo: string;
  faturamento: number;
  quantidade: number;
  /** Só o PDV tem contagem de tickets; nas demais dimensões fica ausente. */
  numeroVendas?: number;
}

export interface ResultadoRanking {
  faturamentoTotal: number;
  pontosTotal: number;
  itens: VendasRanking.ItemRanking[];
  cobertura: {
    faturamentoClassificado: number;
    faturamentoSemClassificacao: number;
    percentual: number;
    linhasSemVinculo: number;
  };
}

/** Centavos, sempre. `0.1 * 0.25` em ponto flutuante não fecha sozinho. */
const centavos = (v: number): number => Math.round(v * 100) / 100;

export function agruparPorChave(linhas: readonly LinhaClassificada[]): ResultadoRanking {
  const somas = new Map<string, { rotulo: string; faturamento: number; quantidade: number; numeroVendas: number | null }>();
  let classificado = 0;
  let semClassificacao = 0;
  let linhasSemVinculo = 0;

  for (const l of linhas) {
    if (!l.chave) {
      /*
       * O que não casou NÃO vira uma fatia no meio do ranking. Somar tudo num
       * "outros" premiaria um setor que não existe e esconderia justamente o
       * buraco de cadastro que causou o problema. Vira cobertura, que é a
       * pergunta certa: sobre quanto do faturamento esta conta foi feita?
       */
      semClassificacao += l.faturamento;
      linhasSemVinculo += 1;
      continue;
    }
    classificado += l.faturamento;
    const atual = somas.get(l.chave) ?? {
      rotulo: l.rotulo, faturamento: 0, quantidade: 0, numeroVendas: l.numeroVendas == null ? null : 0,
    };
    atual.faturamento += l.faturamento;
    atual.quantidade += l.quantidade;
    if (l.numeroVendas != null) atual.numeroVendas = (atual.numeroVendas ?? 0) + l.numeroVendas;
    somas.set(l.chave, atual);
  }

  const faturamentoTotal = centavos(classificado + semClassificacao);

  /*
   * Desempate pelo RÓTULO, não pela ordem de chegada.
   *
   * Sem ele, duas leituras seguidas dos mesmos números podem devolver ordens
   * diferentes — e no painel animado isso vira movimento visível que não
   * aconteceu venda nenhuma para causar. Ranking que treme sozinho perde a
   * confiança de quem olha.
   */
  const ordenados = [...somas.entries()].sort((a, b) =>
    b[1].faturamento - a[1].faturamento || a[1].rotulo.localeCompare(b[1].rotulo, 'pt-BR'));

  const itens: VendasRanking.ItemRanking[] = ordenados.map(([chave, v], i) => ({
    chave,
    rotulo: v.rotulo,
    faturamento: centavos(v.faturamento),
    quantidade: centavos(v.quantidade),
    numeroVendas: v.numeroVendas,
    participacao: faturamentoTotal ? centavos((v.faturamento / faturamentoTotal) * 100) : 0,
    pontos: centavos(v.faturamento * VendasRanking.PONTOS_POR_REAL),
    posicao: i + 1,
  }));

  return {
    faturamentoTotal,
    pontosTotal: centavos(classificado * VendasRanking.PONTOS_POR_REAL),
    itens,
    cobertura: {
      faturamentoClassificado: centavos(classificado),
      faturamentoSemClassificacao: centavos(semClassificacao),
      percentual: faturamentoTotal ? centavos((classificado / faturamentoTotal) * 100) : 0,
      linhasSemVinculo,
    },
  };
}
