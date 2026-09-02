/**
 * Leitura e limpeza das 4 fontes da unificação — sem banco, para poder testar.
 *
 * Princípio: SEM INVENÇÃO. Aqui só se limpa o que atrapalha a leitura (aspas de
 * proteção do Excel, vírgula decimal, "Sim"/"Não"). Nada é derivado, nada é
 * preenchido por conta própria: o que a fonte não traz sai nulo.
 */

/** Fonte de origem de cada linha do staging. */
export const FONTES = ['sia_li', 'compilart_tnp', 'planilha_tnp', 'fiscal_tnp', 'pralis'] as const;
export type Fonte = (typeof FONTES)[number];

/**
 * Parser de CSV de verdade — `split(';')` não serve.
 *
 * As fontes vêm com campo protegido pelo Excel: o CST chega como `"=""040"""`,
 * ou seja, `="040"` embrulhado em aspas CSV com as internas dobradas. Partir na
 * marra no `;` também quebraria em qualquer nome que contenha o separador.
 */
export function parseCsv(texto: string, separador = ';'): string[][] {
  const limpo = texto.replace(/^﻿/, '');
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let dentroDeAspas = false;

  for (let i = 0; i < limpo.length; i += 1) {
    const c = limpo[i]!;

    if (dentroDeAspas) {
      if (c === '"') {
        if (limpo[i + 1] === '"') { campo += '"'; i += 1; } // aspas escapada
        else dentroDeAspas = false;
      } else campo += c;
      continue;
    }

    if (c === '"') { dentroDeAspas = true; continue; }
    if (c === separador) { linha.push(campo); campo = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    campo += c;
  }
  if (campo !== '' || linha.length > 0) { linha.push(campo); linhas.push(linha); }

  return linhas.filter((l) => l.some((v) => v.trim() !== ''));
}

/** Converte o CSV em objetos usando a primeira linha como cabeçalho. */
export function comCabecalho(tabela: string[][]): Array<Record<string, string>> {
  const [cabecalho, ...corpo] = tabela;
  if (!cabecalho) return [];
  const nomes = cabecalho.map((c) => c.trim());
  return corpo.map((linha) => {
    const objeto: Record<string, string> = {};
    nomes.forEach((nome, i) => { objeto[nome] = (linha[i] ?? '').trim(); });
    return objeto;
  });
}

/**
 * Tira a proteção do Excel: `="040"` vira `040`. Sem isso o CST entraria no
 * banco como `="040"` e não casaria com nada.
 */
export const limparProtecao = (valor: unknown): string => {
  const s = String(valor ?? '').trim();
  const m = s.match(/^="?(.*?)"?$/);
  return (m ? m[1]! : s).replace(/^"|"$/g, '').trim();
};

/** Mesma normalização de `barcodeCandidates`: só dígitos, sem zeros à esquerda. */
export const chaveDeBarras = (valor: unknown): string =>
  limparProtecao(valor).replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/**
 * Nome comparável. Maiúscula, sem acento, sem pontuação, espaço colapsado — e
 * SEM caractere de formato: o cadastro do Pralis tem `U+2060` (word joiner)
 * invisível herdado da planilha, e sem tirar isso dois nomes idênticos na tela
 * não casariam.
 *
 * De propósito NÃO remove unidade/quantidade. "COCA COLA 1L" e "COCA COLA 2L"
 * são produtos diferentes, e "ABACAXI UNID" não é "ABACAXI KG" — apagar isso
 * fundiria produtos distintos, que é exatamente a invenção que não pode
 * acontecer. Nome é chave FRACA: serve para sugerir, nunca para decidir.
 */
export const normalizarNome = (valor: unknown): string =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\p{Cf}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/**
 * `A`/`I` (SIA), `Sim`/`Não` (Compilart), `SIM`/`NÃO` (planilha antiga).
 * Devolve `null` quando a fonte não diz — nulo é "não sei", diferente de falso.
 */
export const paraAtivo = (valor: unknown): boolean | null => {
  const s = normalizarNome(limparProtecao(valor));
  if (s === '') return null;
  if (['A', 'S', 'SIM', 'ATIVO', 'TRUE', '1'].includes(s)) return true;
  if (['I', 'N', 'NAO', 'INATIVO', 'FALSE', '0'].includes(s)) return false;
  return null;
};

/** Vírgula decimal (`3,69`) vira número. Vazio ou não-numérico vira nulo. */
export const paraNumero = (valor: unknown): number | null => {
  const s = limparProtecao(valor).replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Uma linha já limpa, pronta para o staging. */
export interface LinhaFonte {
  fonte: Fonte;
  codInterno: string;
  codBarras: string;
  chaveBarras: string;
  nome: string;
  nomeNormalizado: string;
  ativo: boolean | null;
  custo: number | null;
  venda: number | null;
  ncm: string | null;
  cst: string | null;
  csosn: string | null;
  aliqEcf: string | null;
  reducao: number | null;
  aliqInterna: number | null;
  icmsEfetivo: number | null;
  raw: Record<string, string>;
}

const texto = (v: unknown): string | null => {
  const s = limparProtecao(v);
  return s === '' ? null : s;
};

const base = (fonte: Fonte, raw: Record<string, string>): LinhaFonte => ({
  fonte,
  codInterno: limparProtecao(raw.COD_INTERNO ?? raw.CODITEM ?? ''),
  codBarras: limparProtecao(raw.COD_BARRAS ?? ''),
  chaveBarras: chaveDeBarras(raw.COD_BARRAS ?? ''),
  nome: limparProtecao(raw.NOME ?? ''),
  nomeNormalizado: normalizarNome(raw.NOME ?? ''),
  ativo: paraAtivo(raw.ATIVO),
  custo: null,
  venda: null,
  ncm: null,
  cst: null,
  csosn: null,
  aliqEcf: null,
  reducao: null,
  aliqInterna: null,
  icmsEfetivo: null,
  raw,
});

/** Cada fonte tem colunas diferentes; só isto muda entre elas. */
export const MAPEADORES: Record<Exclude<Fonte, 'pralis'>, (raw: Record<string, string>) => LinhaFonte> = {
  sia_li: (raw) => ({
    ...base('sia_li', raw),
    ncm: texto(raw.NCM),
    cst: texto(raw.CST),
    csosn: texto(raw.CSOSN),
    aliqEcf: texto(raw.ALIQ_ECF),
    reducao: paraNumero(raw.REDUCAO),
    aliqInterna: paraNumero(raw.ALIQ_INTERNA),
  }),
  compilart_tnp: (raw) => ({
    ...base('compilart_tnp', raw),
    custo: paraNumero(raw.CUSTO),
    venda: paraNumero(raw.VENDA),
  }),
  planilha_tnp: (raw) => base('planilha_tnp', raw),
  fiscal_tnp: (raw) => ({
    ...base('fiscal_tnp', raw),
    ncm: texto(raw.NCM),
    cst: texto(raw.CST),
    icmsEfetivo: paraNumero(raw.ICMS_EFETIVO),
  }),
};

/** Nome do arquivo esperado por fonte. */
export const ARQUIVOS: Record<Exclude<Fonte, 'pralis'>, string> = {
  sia_li: 'fonte_sia_lisboa.csv',
  compilart_tnp: 'fonte_compilart_tnp.csv',
  planilha_tnp: 'fonte_planilha_antiga_tnp.csv',
  fiscal_tnp: 'fonte_fiscal_tnp_contabilidade.csv',
};

export function lerFonte(fonte: Exclude<Fonte, 'pralis'>, conteudo: string): LinhaFonte[] {
  return comCabecalho(parseCsv(conteudo)).map(MAPEADORES[fonte]);
}

/**
 * Códigos de barras que apontam para mais de um produto DENTRO da mesma fonte.
 *
 * Não bloqueia o carregamento: staging é retrato do que existe, e esconder o
 * problema não o resolve. Vira `barras_conflitante` para a tela cobrar decisão
 * humana — é o caso real do Compilart, onde um EAN cobre "ICE TEA LIMÃO" e
 * "ICE TEA PÊSSEGO".
 */
export function barrasAmbiguas(linhas: LinhaFonte[]): Array<{ chave: string; nomes: string[] }> {
  const porChave = new Map<string, string[]>();
  for (const l of linhas) {
    if (!l.chaveBarras) continue;
    porChave.set(l.chaveBarras, [...(porChave.get(l.chaveBarras) ?? []), l.nome]);
  }
  return [...porChave.entries()]
    .filter(([, nomes]) => new Set(nomes.map(normalizarNome)).size > 1)
    .map(([chave, nomes]) => ({ chave, nomes }));
}
