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

/** Uma seção da aba: `TNP - CADASTRO`, `TRANSFORMAÇÃO`, `CADASTRO GERAL`… */
export interface Faixa {
  nome: string;
  /** Primeira e última coluna da faixa, em letra. */
  inicio: string;
  fim: string;
  inicioIndice: number;
  fimIndice: number;
}

/**
 * As seções que a planilha marca acima da linha de cabeçalho.
 *
 * Existem porque a aba nova **repete cabeçalho de propósito**: `CUSTO`,
 * `CODIGO INT.` e as margens aparecem uma vez por LOJA, lado a lado na mesma
 * linha; `QT` aparece na faixa geral e de novo na de transformação. Casar só
 * por nome pega sempre a primeira ocorrência — escreveria os dados da LI dentro
 * da faixa da TNP, sem erro nenhum para avisar.
 *
 * Cada rótulo abre uma faixa que vai até o rótulo seguinte.
 */
export function faixasDaAba(linha: readonly unknown[], letra: (i: number) => string): Faixa[] {
  const marcos: Array<{ nome: string; i: number }> = [];
  linha.forEach((valor, i) => {
    const nome = normalizarCabecalho(valor);
    if (nome) marcos.push({ nome, i });
  });

  return marcos.map((m, k) => {
    const fim = k + 1 < marcos.length ? marcos[k + 1]!.i - 1 : linha.length - 1;
    return {
      nome: m.nome,
      inicio: letra(m.i),
      fim: letra(fim),
      inicioIndice: m.i,
      fimIndice: fim,
    };
  });
}

/**
 * A coluna de um cabeçalho DENTRO de uma faixa.
 *
 * `null` quando a faixa não existe ou não tem aquele cabeçalho — de propósito:
 * não escrever é sempre melhor do que escrever na faixa errada.
 */
export function colunaNaFaixa(
  linhaCabecalho: readonly unknown[],
  faixas: readonly Faixa[],
  nomeDaFaixa: string,
  nomeDoCabecalho: string,
  letra: (i: number) => string,
): string | null {
  const alvo = normalizarCabecalho(nomeDaFaixa);
  const faixa = faixas.find((f) => f.nome === alvo);
  if (!faixa) return null;

  const procurado = normalizarCabecalho(nomeDoCabecalho);
  for (let i = faixa.inicioIndice; i <= faixa.fimIndice; i += 1) {
    if (normalizarCabecalho(linhaCabecalho[i]) === procurado) return letra(i);
  }
  return null;
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
 * nova a cada sincronismo: o mesmo produto duplicado a cada rodada.
 */
export function conferirAbaDeDestino(
  colunaNoDestino: Map<string, string>,
): { pronta: boolean; faltando: string[] } {
  const obrigatorios = ['ID', 'NOME'];
  const faltando = obrigatorios.filter((n) => !colunaNoDestino.has(n));
  return { pronta: faltando.length === 0, faltando };
}
