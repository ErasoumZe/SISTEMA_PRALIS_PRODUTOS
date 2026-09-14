import { barcodeCandidates } from '@/modules/apoio/tax-rule.service';
import type { VendasSchemas } from '@pralis/shared';

/** O que a margem precisa saber de um produto do cadastro. */
export interface ProdutoCadastro {
  id: string;
  nome: string;
  codigoBarras: string | null;
  custo: number | null;
  qtCad: number;
  /** Só para montar a descrição nas sugestões de de-para. */
  quantidade?: number | null;
  medidaBase?: string | null;
  /**
   * Campos de CLASSIFICAÇÃO — o ranking por grupo e por setor sai daqui.
   *
   * Moram nesta interface, e não numa paralela, porque o ranking precisa casar
   * venda com produto pela MESMA regra da margem: `resolverProduto`, de-para
   * confirmado na frente do automático. Duas regras de casamento fariam a
   * margem e o ranking discordarem sobre qual produto é qual venda — e as duas
   * telas mostrariam números que não fecham entre si, sem ninguém saber por quê.
   */
  grupo?: string | null;
  setorEstoque?: string | null;
  setorVenda1?: string | null;
}

/** Uma linha de venda vinda do PDV. */
export interface LinhaVenda {
  produtoCodigo: string;
  produto: string;
  quantidade: number;
  total: number;
}

/**
 * Índice `chave normalizada -> produto`, montado a partir do cadastro.
 *
 * As chaves saem de `barcodeCandidates`, a MESMA função usada na classificação
 * fiscal: ela devolve o código limpo e, para EAN de balança (`2` + 5 dígitos),
 * também o PLU. É isso que faz pão, salgado e granel casarem sozinhos — o
 * código que o Creare exporta para pesável é exatamente esse PLU.
 *
 * Chave AMBÍGUA (dois produtos do cadastro gerando a mesma) é REMOVIDA do
 * índice de propósito: casar com o produto errado calcularia margem com o
 * custo errado em silêncio. Ambíguo vira pendência de de-para, que é honesto.
 */
export function indexarPorCodigo(produtos: ProdutoCadastro[]): Map<string, ProdutoCadastro> {
  const indice = new Map<string, ProdutoCadastro>();
  const ambiguas = new Set<string>();

  for (const produto of produtos) {
    for (const chave of barcodeCandidates(produto.codigoBarras)) {
      if (!chave) continue;
      const existente = indice.get(chave);
      if (existente && existente.id !== produto.id) {
        ambiguas.add(chave);
        continue;
      }
      indice.set(chave, produto);
    }
  }
  for (const chave of ambiguas) indice.delete(chave);
  return indice;
}

/**
 * Resolve o produto de um código do PDV. O de-para confirmado por pessoa tem
 * precedência sobre o casamento automático — se alguém corrigiu à mão, foi
 * porque o automático não servia.
 */
/** Chave do de-para: espelha a identidade da venda (codigo + descricao). */
export const chaveDePara = (produtoCodigo: string, produto: string): string =>
  `${produtoCodigo.trim()}|${produto.trim()}`;

export function resolverProduto(
  produtoCodigo: string,
  produto: string,
  indice: Map<string, ProdutoCadastro>,
  dePara: Map<string, ProdutoCadastro>,
): ProdutoCadastro | null {
  const manual = dePara.get(chaveDePara(produtoCodigo, produto));
  if (manual) return manual;
  for (const chave of barcodeCandidates(produtoCodigo)) {
    const achado = indice.get(chave);
    if (achado) return achado;
  }
  return null;
}

/** Custo de UMA unidade vendida: o cadastro guarda o custo da embalagem. */
export function custoUnitario(produto: ProdutoCadastro): number | null {
  if (produto.custo == null || !Number.isFinite(produto.custo)) return null;
  const divisor = produto.qtCad > 0 ? produto.qtCad : 1;
  return produto.custo / divisor;
}

const arredondar = (v: number) => Math.round(v * 100) / 100;

/**
 * Margem do período com a COBERTURA declarada.
 *
 * A margem percentual é calculada sobre o faturamento COM custo, nunca sobre o
 * total: dizer "margem de 12%" quando 40% do faturamento não tem custo
 * cadastrado seria inventar número.
 */
export function calcularMargem(
  vendas: LinhaVenda[],
  indice: Map<string, ProdutoCadastro>,
  dePara: Map<string, ProdutoCadastro>,
): VendasSchemas.Margem {
  let faturamentoComCusto = 0;
  let faturamentoSemCusto = 0;
  let custoTotal = 0;
  const semVinculo = new Set<string>();

  for (const venda of vendas) {
    const cadastrado = resolverProduto(venda.produtoCodigo, venda.produto, indice, dePara);
    const unitario = cadastrado ? custoUnitario(cadastrado) : null;

    if (unitario == null) {
      faturamentoSemCusto += venda.total;
      // agrupa por código para não contar o mesmo produto em vários dias
      semVinculo.add(chaveDePara(venda.produtoCodigo, venda.produto));
      continue;
    }
    faturamentoComCusto += venda.total;
    custoTotal += unitario * venda.quantidade;
  }

  const total = faturamentoComCusto + faturamentoSemCusto;
  const lucroBruto = faturamentoComCusto - custoTotal;
  return {
    faturamentoComCusto: arredondar(faturamentoComCusto),
    faturamentoSemCusto: arredondar(faturamentoSemCusto),
    coberturaPercentual: total > 0 ? arredondar((faturamentoComCusto / total) * 100) : 0,
    produtosSemVinculo: semVinculo.size,
    custoTotal: arredondar(custoTotal),
    lucroBruto: arredondar(lucroBruto),
    margemPercentual: faturamentoComCusto > 0 ? arredondar((lucroBruto / faturamentoComCusto) * 100) : 0,
  };
}

/**
 * Semelhança 0..100 entre dois nomes, por bigramas (coeficiente de Dice).
 * Serve só para ORDENAR sugestões na tela de de-para — nunca para vincular
 * sozinha.
 */
export function semelhanca(a: string, b: string): number {
  const normalizar = (s: string) => s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return 0;
  if (x === y) return 100;

  const bigramas = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const par = s.slice(i, i + 2);
      out.set(par, (out.get(par) ?? 0) + 1);
    }
    return out;
  };
  const ba = bigramas(x);
  const bb = bigramas(y);
  let comuns = 0;
  for (const [par, n] of ba) comuns += Math.min(n, bb.get(par) ?? 0);
  const totalA = [...ba.values()].reduce((s, n) => s + n, 0);
  const totalB = [...bb.values()].reduce((s, n) => s + n, 0);
  if (totalA + totalB === 0) return 0;
  return Math.round(((2 * comuns) / (totalA + totalB)) * 100);
}
