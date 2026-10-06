/**
 * Como os números dos relatórios de venda se escrevem.
 *
 * Vive no contrato compartilhado, e não em cada tela, pelo mesmo motivo de
 * `product/money.ts`: a regra é a mesma em qualquer lugar que mostre o número.
 * Antes disto, "pontos" tinha cinco definições diferentes espalhadas entre a
 * página de vendas, a de gerentes e três componentes — e todas com duas casas
 * decimais.
 *
 * PONTUAÇÃO NÃO TEM CASA DECIMAL (decisão do José em 06/10/2026).
 * Ponto é placar, não dinheiro: `2.284,78 pts` dá uma precisão que a medida
 * não tem e atrapalha a leitura rápida do gráfico. O arredondamento é só de
 * exibição; a conta por trás continua com o valor cheio, então a soma dos dias
 * mostrados pode diferir do total mostrado em 1 ponto. Preferimos isso a
 * truncar o dado.
 */

const pt = (valor: number, casas: number, minimo = 0) => valor.toLocaleString('pt-BR', {
  minimumFractionDigits: minimo,
  maximumFractionDigits: casas,
});

/** Número finito, ou zero. Protege o `toLocaleString` de `NaN`/`Infinity`. */
const seguro = (valor: number | null | undefined): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/** Pontuação: inteiro, sempre. `2.284,78` vira `2.285`. */
export const formatarPontos = (valor: number | null | undefined): string => pt(Math.round(seguro(valor)), 0);

/** Pontuação com a unidade colada, que é como ela aparece em quase todo lugar. */
export const pontosComUnidade = (valor: number | null | undefined): string => `${formatarPontos(valor)} pts`;

/**
 * Percentual já em 0–100. Uma casa decimal: `2,1%`.
 *
 * Abaixo de 0,1% e acima de zero vira `<0,1%` em vez de `0%` — um produto que
 * vendeu não pode aparecer como se não tivesse vendido.
 */
export const formatarPercentual = (valor: number | null | undefined, casas = 1): string => {
  const n = seguro(valor);
  const minimo = 1 / 10 ** casas;
  if (n > 0 && n < minimo) return `<${pt(minimo, casas, casas)}%`;
  return `${pt(n, casas)}%`;
};

/**
 * Quantidade vendida: até duas casas, sem zeros à direita.
 *
 * Aqui NÃO se arredonda para inteiro: produto de balança vende `2,5` kg, e
 * `3 kg` seria outra informação.
 */
export const formatarQuantidade = (valor: number | null | undefined): string => pt(seguro(valor), 2);

/** Fatia de `parte` em `total`, em 0–100. Total zero devolve 0, não `NaN`. */
export const participacao = (parte: number | null | undefined, total: number | null | undefined): number => {
  const t = seguro(total);
  if (t === 0) return 0;
  return (seguro(parte) / t) * 100;
};
