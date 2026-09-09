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
export const FAIXA_INICIAL = '(INICIO)';

export function faixasDaAba(
  linha: readonly unknown[],
  letra: (i: number) => string,
  /**
   * Largura real da aba. A linha de rotulos costuma vir mais curta que a de
   * cabecalhos — o Sheets corta as celulas vazias do fim —, e sem isso a
   * ultima faixa terminava antes das colunas que existem de verdade.
   */
  largura?: number,
): Faixa[] {
  const marcos: Array<{ nome: string; i: number }> = [];
  linha.forEach((valor, i) => {
    const nome = normalizarCabecalho(valor);
    if (nome) marcos.push({ nome, i });
  });
  if (marcos.length === 0) return [];

  const ultimo = Math.max(largura ?? linha.length, linha.length) - 1;
  const faixas: Faixa[] = [];

  /*
   * As primeiras colunas costumam ficar ANTES do primeiro rotulo (status, nome
   * do produto). Sem uma faixa para elas, campo nenhum de la teria destino.
   */
  if (marcos[0]!.i > 0) {
    faixas.push({
      nome: FAIXA_INICIAL, inicio: letra(0), fim: letra(marcos[0]!.i - 1),
      inicioIndice: 0, fimIndice: marcos[0]!.i - 1,
    });
  }

  marcos.forEach((m, k) => {
    const fim = k + 1 < marcos.length ? marcos[k + 1]!.i - 1 : ultimo;
    faixas.push({ nome: m.nome, inicio: letra(m.i), fim: letra(fim), inicioIndice: m.i, fimIndice: fim });
  });
  return faixas;
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

/** Faixas que guardam dado de UMA loja. O resto vale para o produto inteiro. */
const FAIXA_DA_LOJA: Record<string, readonly string[]> = {
  TNP: ['TNP - CADASTRO', 'TNP - PROMOÇÃO'],
  LI: ['LI - CADASTRO', 'LI - PROMOÇÃO'],
};

const ehFaixaDeLoja = (nome: string): boolean =>
  Object.values(FAIXA_DA_LOJA).some((fs) => fs.includes(nome));

export interface DestinoInput {
  /** Cabeçalho do campo, como aparece na linha 5. */
  nome: string;
  /** Loja do produto. Sem ela, campo de loja não é escrito. */
  loja?: string | null;
  /** Desempate quando o mesmo nome existe em duas faixas que não são de loja. */
  faixa?: string;
  faixas: readonly Faixa[];
  cabecalhos: readonly unknown[];
  letra: (i: number) => string;
}

/**
 * Em que coluna este campo deve ser escrito.
 *
 * A regra sai da **própria planilha**, não de uma classificação minha de 50
 * campos: se o cabeçalho aparece nas faixas de loja, o campo é por loja; se
 * aparece numa faixa só, é dela.
 *
 * Devolve `null` — e isso é o comportamento certo, não uma falha — quando:
 *  - o campo é de loja e não veio loja (produto da BASE não preenche a faixa
 *    da loja; isso acontece quando a loja importa e completa o cadastro);
 *  - o nome existe em mais de uma faixa não-loja e ninguém desempatou (`QT`
 *    está na geral e na de transformação: chutar seria gravar no campo errado);
 *  - a aba não tem esse campo.
 */
export function resolverDestino(input: DestinoInput): string | null {
  const { nome, loja, faixa, faixas, cabecalhos, letra } = input;
  const procurado = normalizarCabecalho(nome);
  if (!procurado) return null;

  const achar = (nomeDaFaixa: string) =>
    colunaNaFaixa(cabecalhos, faixas, nomeDaFaixa, procurado, letra);

  // desempate explícito manda em tudo
  if (faixa) return achar(faixa);

  const comOCampo = faixas.filter((f) => achar(f.nome) !== null);
  if (comOCampo.length === 0) return null;

  const deLoja = comOCampo.filter((f) => ehFaixaDeLoja(f.nome));
  const gerais = comOCampo.filter((f) => !ehFaixaDeLoja(f.nome));

  if (loja && deLoja.length > 0) {
    const daLoja = (FAIXA_DA_LOJA[loja] ?? []).map(normalizarCabecalho);
    const alvo = deLoja.find((f) => daLoja.includes(f.nome));
    if (alvo) return achar(alvo.nome);
  }

  /*
   * Sem loja — produto da BASE — vale a faixa geral. Campo que SO existe em
   * faixa de loja fica para a importacao, que e quando a loja completa o
   * cadastro.
   */
  if (gerais.length === 1) return achar(gerais[0]!.nome);

  // ambiguo entre faixas gerais sem desempate: nao escreve
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
