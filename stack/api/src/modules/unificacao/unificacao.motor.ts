/**
 * Motor de reconciliação: junta as linhas das fontes em GRUPOS de prováveis
 * mesmos produtos. Não decide nada e não escreve no catálogo — só agrupa e
 * mostra o que diverge, para a decisão ser humana.
 *
 * Sem banco de propósito, para poder ser testado.
 */

export type LojaFonte = 'LI' | 'TNP' | 'BASE' | 'HORA';
export type MotivoGrupo = 'mesmo_cod_barras' | 'mesmo_cod_interno' | 'nome_parecido' | 'unico';

/** Uma linha do staging, já pronta para agrupar. */
export interface ItemFonte {
  id: string;
  fonte: string;
  loja: LojaFonte;
  codInterno: string;
  codBarras: string;
  chaveBarras: string;
  nome: string;
  nomeNormalizado: string;
  ativo: boolean | null;
  grupo: string | null;
  custo: number | null;
  venda: number | null;
  ncm: string | null;
  cst: string | null;
  csosn: string | null;
  aliqEcf: string | null;
  reducao: number | null;
  icmsEfetivo: number | null;
}

/** O cadastro proposto. Cada campo diz de qual fonte veio. */
export interface CandidatoUnificado {
  nome: string;
  nomeDe: string;
  grupo: string | null;
  grupoDe: string | null;
  custo: number | null;
  custoDe: string | null;
  venda: number | null;
  vendaDe: string | null;
  ativo: boolean;
  /** Fiscal da Lisboa, do SIA. Copiado, nunca derivado. */
  fiscalLi: { ncm: string | null; cst: string | null; csosn: string | null; aliqEcf: string | null; reducao: number | null } | null;
  /** Fiscal da TNP, da contabilidade. Nulo = a TNP não tem fiscal para este produto. */
  fiscalTnp: { ncm: string | null; cst: string | null; icmsEfetivo: number | null } | null;
}

export interface GrupoReconciliado {
  chave: string;
  motivo: MotivoGrupo;
  itens: ItemFonte[];
  fontes: string[];
  lojas: LojaFonte[];
  candidato: CandidatoUnificado;
  flags: {
    nomesDivergentes: boolean;
    semFiscalTnp: boolean;
    semBarras: boolean;
    barrasConflitante: boolean;
    semGrupo: boolean;
    jaNoPralis: boolean;
  };
}

/**
 * As fontes da TNP sem coluna de barras (planilha antiga e fiscal da
 * contabilidade) guardam no `COD_INTERNO` a MESMA linhagem de código do Creare
 * que as outras fontes guardam em `COD_BARRAS`.
 *
 * Medido em 02/09/2026: o fiscal casa 900 de 940 pelo COD_BARRAS do Compilart e
 * ZERO pelo COD_INTERNO dele. Usar o COD_INTERNO como chave da própria loja
 * daria cobertura fiscal nenhuma.
 */
const FONTES_CHAVE_NO_INTERNO = new Set(['planilha_tnp', 'fiscal_tnp']);

const soDigitos = (v: string) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/** A chave FORTE do item: barras quando existe, senão o código do Creare. */
export function chaveForte(item: ItemFonte): string {
  if (item.chaveBarras) return item.chaveBarras;
  if (FONTES_CHAVE_NO_INTERNO.has(item.fonte)) return soDigitos(item.codInterno);
  return '';
}

class UnionFind {
  private pai = new Map<string, string>();

  achar(x: string): string {
    if (!this.pai.has(x)) this.pai.set(x, x);
    const p = this.pai.get(x)!;
    if (p === x) return x;
    const raiz = this.achar(p);
    this.pai.set(x, raiz);
    return raiz;
  }

  unir(a: string, b: string): void {
    const ra = this.achar(a);
    const rb = this.achar(b);
    if (ra !== rb) this.pai.set(ra, rb);
  }
}

/**
 * De qual fonte sai o NOME do candidato, em ordem de preferência.
 *
 * Fonte que não está aqui não empresta nome — e um grupo formado só por ela
 * ficaria SEM NOME, o que o esconde da busca e da tela. Foi o que aconteceu ao
 * acrescentar `planilha_nova` e `vendidos_tnp` sem tocar nesta lista.
 *
 * As duas entram no FIM de propósito: assim os grupos que já existiam mantêm
 * exatamente o nome que tinham, e só quem não tinha nenhum passa a ter.
 */
const ORDEM_NOME = [
  'pralis', 'compilart_tnp', 'sia_li', 'vendas_pdv_12m', 'planilha_tnp', 'fiscal_tnp',
  'planilha_nova', 'vendidos_tnp',
];

const primeiroPor = <T>(
  itens: ItemFonte[],
  ordem: string[],
  extrair: (i: ItemFonte) => T | null | undefined,
): { valor: T; de: string } | null => {
  for (const fonte of ordem) {
    for (const item of itens.filter((i) => i.fonte === fonte)) {
      const v = extrair(item);
      if (v != null && v !== '') return { valor: v as T, de: fonte };
    }
  }
  return null;
};

/**
 * Monta o cadastro proposto. Cada campo vem de UMA fonte identificada — nada é
 * calculado, misturado ou preenchido por conta própria.
 */
export function montarCandidato(itens: ItemFonte[]): CandidatoUnificado {
  const nome = primeiroPor(itens, ORDEM_NOME, (i) => i.nome);
  /*
   * Custo e venda vêm do Compilart ANTES do Pralis, de propósito: o Compilart é
   * o catálogo vivo da loja, e o Pralis pode estar com valor velho. Isso vale
   * para criar E para atualizar — se a ordem fosse diferente nos dois, o "Vai
   * gravar" mostraria um valor e a atualização gravaria outro.
   *
   * Nome e grupo NÃO seguem essa regra: ali o que o José curou no Pralis manda.
   */
  const custo = primeiroPor(itens, ['compilart_tnp', 'pralis'], (i) => i.custo);
  const venda = primeiroPor(itens, ['compilart_tnp', 'pralis'], (i) => i.venda);
  // grupo só existe no SIA e no Pralis; sem eles fica "A CLASSIFICAR"
  const grupo = primeiroPor(itens, ['sia_li', 'pralis'], (i) => i.grupo);

  const doSia = itens.find((i) => i.fonte === 'sia_li');
  const doFiscalTnp = itens.find((i) => i.fonte === 'fiscal_tnp');

  return {
    nome: nome?.valor ?? '',
    nomeDe: nome?.de ?? '',
    grupo: grupo?.valor ?? null,
    grupoDe: grupo?.de ?? null,
    custo: custo?.valor ?? null,
    custoDe: custo?.de ?? null,
    venda: venda?.valor ?? null,
    vendaDe: venda?.de ?? null,
    // "todo produto entra; os parados entram como INATIVO": ativo se ALGUMA
    // fonte ainda o considera ativo
    ativo: itens.some((i) => i.ativo === true),
    fiscalLi: doSia
      ? { ncm: doSia.ncm, cst: doSia.cst, csosn: doSia.csosn, aliqEcf: doSia.aliqEcf, reducao: doSia.reducao }
      : null,
    fiscalTnp: doFiscalTnp
      ? { ncm: doFiscalTnp.ncm, cst: doFiscalTnp.cst, icmsEfetivo: doFiscalTnp.icmsEfetivo }
      : null,
  };
}

function motivoDo(itens: ItemFonte[]): MotivoGrupo {
  if (itens.length === 1) return 'unico';

  const chaves = itens.map(chaveForte).filter(Boolean);
  if (new Set(chaves).size < chaves.length) return 'mesmo_cod_barras';

  // código interno só vale DENTRO da mesma loja — nunca cruza
  const porLoja = new Map<string, string[]>();
  for (const i of itens) {
    if (!i.codInterno) continue;
    const k = i.loja;
    porLoja.set(k, [...(porLoja.get(k) ?? []), i.codInterno]);
  }
  for (const internos of porLoja.values()) {
    if (new Set(internos).size < internos.length) return 'mesmo_cod_interno';
  }

  return 'nome_parecido';
}

export interface EntradaAgrupamento {
  itens: ItemFonte[];
  /** Chaves de barras que cobrem produtos diferentes dentro de alguma fonte. */
  barrasConflitantes: Set<string>;
}

/**
 * Agrupa por união de duas chaves:
 *  - chave FORTE (código de barras / código do Creare): cruza lojas;
 *  - nome normalizado: chave FRACA, só sugere.
 *
 * Medido sobre as 12.844 linhas reais: incluir o nome dá 4.322 grupos com o
 * maior tendo 10 linhas — não há cascata de contaminação. Sem o nome seriam
 * 5.274 grupos, separando produtos que são o mesmo.
 */
export function agrupar({ itens, barrasConflitantes }: EntradaAgrupamento): GrupoReconciliado[] {
  const uf = new UnionFind();

  itens.forEach((item, i) => {
    const no = `L${i}`;
    uf.achar(no);
    const forte = chaveForte(item);
    if (forte) uf.unir(no, `B:${forte}`);
    if (item.nomeNormalizado) uf.unir(no, `N:${item.nomeNormalizado}`);
  });

  const porRaiz = new Map<string, ItemFonte[]>();
  itens.forEach((item, i) => {
    const raiz = uf.achar(`L${i}`);
    porRaiz.set(raiz, [...(porRaiz.get(raiz) ?? []), item]);
  });

  return [...porRaiz.values()].map((doGrupo) => {
    const chaves = doGrupo.map(chaveForte).filter(Boolean).sort();
    const lojas = [...new Set(doGrupo.map((i) => i.loja))].sort();
    const fontes = [...new Set(doGrupo.map((i) => i.fonte))].sort();
    const nomes = new Set(doGrupo.map((i) => i.nomeNormalizado).filter(Boolean));

    return {
      // a menor chave forte identifica o grupo de forma estável entre recálculos
      chave: chaves[0] ?? `nome:${doGrupo[0]!.nomeNormalizado}`,
      motivo: motivoDo(doGrupo),
      itens: doGrupo,
      fontes,
      lojas,
      candidato: montarCandidato(doGrupo),
      flags: {
        nomesDivergentes: nomes.size > 1,
        // só é buraco fiscal se a TNP está no grupo
        semFiscalTnp: lojas.includes('TNP') && !fontes.includes('fiscal_tnp'),
        semBarras: doGrupo.every((i) => i.chaveBarras === ''),
        barrasConflitante: chaves.some((c) => barrasConflitantes.has(c)),
        semGrupo: doGrupo.every((i) => !i.grupo),
        jaNoPralis: fontes.includes('pralis'),
      },
    };
  }).filter((grupo) => !(
    grupo.candidato.nome.trim() === ''
    && grupo.fontes.every((fonte) => fonte === 'fiscal_tnp')
  ));
}
