/**
 * Quanto cada forma de pagamento pesa no período.
 *
 * A API devolve o fechamento DIA A DIA, uma coluna por forma. Quem olha o
 * relatório quer a outra pergunta: "do que entrou, quanto foi pix?". Somar as
 * colunas é conta de uma linha, mas ela estava faltando — e feita na tela, em
 * dois lugares, viraria duas respostas.
 *
 * A base do percentual é a SOMA DAS FORMAS, não o faturamento dos produtos.
 * São fontes diferentes: pagamento vem do fechamento de caixa, que inclui
 * lançamentos que não são venda de produto. Usar o faturamento como base daria
 * percentuais que não fecham em 100% e ninguém saberia por quê.
 *
 * `roubo/furto` e `sobra/perda` podem ser NEGATIVOS. Eles entram na soma como
 * estão — é o que o caixa fechou. A consequência é que, com ajuste negativo
 * grande, uma forma pode passar de 100%; isso é a aritmética contando a
 * verdade, não um defeito.
 */

export interface FormaPagamento {
  chave: string;
  label: string;
}

export interface FatiaPagamento extends FormaPagamento {
  total: number;
  /** Fatia da soma das formas, 0 a 100. */
  percentual: number;
}

export interface ResumoPagamentos {
  /** Soma de todas as formas no período. É a base dos percentuais. */
  total: number;
  /** Só as formas com movimento, da maior para a menor. */
  itens: FatiaPagamento[];
  /** Quantas formas ficaram de fora por não terem movimento nenhum. */
  semMovimento: number;
}

const numero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

export function resumirPagamentos(
  linhas: ReadonlyArray<Record<string, unknown>>,
  formas: ReadonlyArray<FormaPagamento>,
): ResumoPagamentos {
  const somas = new Map<string, number>();
  for (const forma of formas) {
    let soma = 0;
    for (const linha of linhas) soma += numero(linha[forma.chave]);
    somas.set(forma.chave, soma);
  }
  const total = [...somas.values()].reduce((acc, v) => acc + v, 0);
  const itens = formas
    .map((forma) => {
      const valor = somas.get(forma.chave) ?? 0;
      return {
        ...forma,
        total: valor,
        percentual: total === 0 ? 0 : (valor / total) * 100,
      };
    })
    .filter((item) => item.total !== 0)
    .sort((a, b) => b.total - a.total);
  return { total, itens, semMovimento: formas.length - itens.length };
}
