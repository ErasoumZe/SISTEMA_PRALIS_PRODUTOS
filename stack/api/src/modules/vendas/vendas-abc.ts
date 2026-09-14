/**
 * A classe ABC de CADA produto — não só o resumo por classe.
 *
 * O resumo responde "quanto a classe A fatura"; esta função responde "QUAIS
 * produtos são a classe A", que é a pergunta de quem precisa decidir o que não
 * pode faltar na prateleira.
 *
 * Fica separada de banco e de HTTP para poder ser conferida no braço: a regra
 * do acumulado é fácil de errar por um produto, e esse produto é justamente o
 * que está na fronteira.
 */

/** O mínimo que a classificação precisa de uma linha de venda. */
export interface VendaDoProduto {
  produtoCodigo: string;
  produto: string;
  quantidade: number;
  faturamento: number;
}

export interface ProdutoClassificado extends VendaDoProduto {
  classe: 'A' | 'B' | 'C';
  posicao: number;
  participacao: number;
  acumulado: number;
}

const umaCasa = (v: number): number => Math.round(v * 10) / 10;
const duasCasas = (v: number): number => Math.round(v * 100) / 100;

/**
 * Classifica pelo acumulado ANTES do produto entrar.
 *
 * É a mesma regra do resumo da curva, de propósito — se as duas divergissem, a
 * tela mostraria "135 produtos na classe A" e uma lista com outro tamanho.
 *
 * O produto que CRUZA a linha dos 80% fica em A, não em B: ele entrou quando o
 * acumulado ainda era menor que 80. Sem isso, a classe A nunca chegaria a somar
 * os 80% que a definem.
 */
export function classificarAbc(
  vendas: readonly VendaDoProduto[],
  total: number,
): ProdutoClassificado[] {
  let acumulado = 0;
  return [...vendas]
    .sort((a, b) => b.faturamento - a.faturamento
      || a.produto.localeCompare(b.produto, 'pt-BR'))
    .map((v, i) => {
      const antes = total > 0 ? acumulado / total : 1;
      const classe: 'A' | 'B' | 'C' = antes < 0.8 ? 'A' : antes < 0.95 ? 'B' : 'C';
      acumulado += v.faturamento;
      return {
        ...v,
        classe,
        posicao: i + 1,
        participacao: total > 0 ? duasCasas((v.faturamento / total) * 100) : 0,
        acumulado: total > 0 ? duasCasas((acumulado / total) * 100) : 0,
      };
    });
}

/**
 * Em quantos dias a venda do período consumiria o estoque MÁXIMO cadastrado.
 *
 * O que este número NÃO é: quanto tempo o estoque de hoje dura. Para isso seria
 * preciso saber o saldo atual, e o sistema não guarda saldo — nem no banco, nem
 * na planilha (a aba de estoque é um formulário de contagem mensal, com a
 * coluna de quantidade em branco).
 *
 * O que ele É: o teto. Mesmo com a prateleira cheia até o máximo cadastrado, o
 * produto acaba em tantos dias nesse ritmo de venda. Serve para ordenar o que
 * merece atenção — quem tem teto para três dias precisa de reposição muito mais
 * frequente que quem tem para trinta.
 *
 * `null` sempre que faltar o teto ou faltar venda: número inventado aqui vira
 * decisão de compra errada.
 */
export function diasDeMaximo(
  estoqueMax: number | null,
  quantidadeVendida: number,
  diasDoPeriodo: number,
): number | null {
  if (!estoqueMax || estoqueMax <= 0) return null;
  if (!quantidadeVendida || quantidadeVendida <= 0) return null;
  if (!diasDoPeriodo || diasDoPeriodo <= 0) return null;
  const porDia = quantidadeVendida / diasDoPeriodo;
  return porDia > 0 ? umaCasa(estoqueMax / porDia) : null;
}
