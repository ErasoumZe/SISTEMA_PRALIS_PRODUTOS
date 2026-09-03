import type { CellMap } from './product-sheet.mapper';

/**
 * Traduz um `CellMap` da BASE para outra aba, casando as colunas pelo NOME do
 * cabeçalho.
 *
 * Por que por nome e não por posição: medido em 03/09/2026 na planilha de
 * produção, das 62 colunas que a aba TNP tem em comum com a BASE, **61 estão em
 * posição diferente**. `COMO SE COMPRA` é `P` na BASE e `Z` na TNP;
 * `REDUCAO_ICMS` é `BS` e `CB`. Um mapa por posição gravaria custo na coluna de
 * alíquota.
 *
 * O que a aba de destino não tem, não é escrito — em vez de escrever no lugar
 * errado. E o que a aba ganhar depois passa a ser preenchido sozinho, sem
 * mexer em código.
 */

export interface ResultadoTraducao {
  /** Células já na letra de coluna da aba de DESTINO. */
  celulas: CellMap;
  /** Cabeçalhos que a origem tem e o destino não. Ficam de fora, e aparecem no health. */
  semCorrespondencia: string[];
  /** Colunas da origem sem cabeçalho: não dá para casar por nome. */
  semCabecalho: string[];
}

/** Normaliza para comparar: sem caractere invisível, sem espaço duplo, maiúscula. */
export const normalizarCabecalho = (valor: unknown): string =>
  String(valor ?? '')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');

/** `['A/I','','NOME']` → `{ A: 'A/I', C: 'NOME' }`. Coluna sem cabeçalho fica de fora. */
export function cabecalhosPorColuna(linha: readonly unknown[], letra: (i: number) => string): Map<string, string> {
  const mapa = new Map<string, string>();
  linha.forEach((valor, i) => {
    const nome = normalizarCabecalho(valor);
    if (nome) mapa.set(letra(i), nome);
  });
  return mapa;
}

/**
 * `['A/I','','NOME']` → `{ 'A/I': 'A', NOME: 'C' }`.
 * Cabeçalho repetido fica com a PRIMEIRA coluna: escrever nas duas duplicaria
 * o valor, e a primeira é a que as fórmulas históricas usam.
 */
export function colunasPorCabecalho(linha: readonly unknown[], letra: (i: number) => string): Map<string, string> {
  const mapa = new Map<string, string>();
  linha.forEach((valor, i) => {
    const nome = normalizarCabecalho(valor);
    if (nome && !mapa.has(nome)) mapa.set(nome, letra(i));
  });
  return mapa;
}

export function traduzirCelulas(
  celulas: CellMap,
  cabecalhoDaOrigem: Map<string, string>,
  colunaNoDestino: Map<string, string>,
): ResultadoTraducao {
  const saida: CellMap = {};
  const semCorrespondencia: string[] = [];
  const semCabecalho: string[] = [];

  for (const [colunaOrigem, celula] of Object.entries(celulas)) {
    const nome = cabecalhoDaOrigem.get(colunaOrigem);
    if (!nome) {
      // colunas auxiliares da BASE (flags que as fórmulas usam) não têm
      // cabeçalho e por isso não têm como ser casadas
      semCabecalho.push(colunaOrigem);
      continue;
    }
    const destino = colunaNoDestino.get(nome);
    if (!destino) {
      semCorrespondencia.push(nome);
      continue;
    }
    saida[destino] = celula;
  }

  return {
    celulas: saida,
    semCorrespondencia: [...new Set(semCorrespondencia)].sort(),
    semCabecalho: semCabecalho.sort(),
  };
}

/**
 * A aba de destino está pronta para receber o espelho?
 *
 * `ID` é obrigatório e não é detalhe: é ele que diz qual linha atualizar. Sem
 * ele o espelho não tem como reencontrar o produto e passaria a criar uma linha
 * nova a cada sincronismo — 9.930 linhas viram 19.860 na segunda rodada.
 */
export function conferirAbaDeDestino(
  colunaNoDestino: Map<string, string>,
): { pronta: boolean; faltando: string[] } {
  const obrigatorios = ['ID', 'NOME'];
  const faltando = obrigatorios.filter((n) => !colunaNoDestino.has(n));
  return { pronta: faltando.length === 0, faltando };
}
