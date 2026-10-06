import { barcodeCandidates } from '@/modules/apoio/tax-rule.service';
import { codigoSia } from './pesaveis-exportacao';

/**
 * Plano da padronização de pesável: TODO produto ativo da loja vira
 * `S`, tecla 000, validade 5 — e o espelho SIA de cada um passa a dizer o mesmo.
 *
 * Decisão do José em 06/10/2026, depois de importar o TXT na padaria e ver
 * produto entrando como não pesável no SIA: "padroniza pra todos os ativos sim
 * [...] quero todos os ativos sendo pesaveis, mesmo um produto que não seja,
 * vai ser mais facil trocar tudo pra sim e depois ir editando". A edição por
 * produto continua livre na tela de Produtos; isto só é o ponto de partida.
 *
 * Segunda decisão, no mesmo dia, depois da balança recusar a importação
 * ("código do produto deve ficar entre 1 e 999999"): produto com código de
 * barras PRÓPRIO — diferente do código interno — fica `N`. É o item de
 * indústria (EAN-13 de 13 dígitos), que a balança não aceita como código.
 * Barras de balança (EAN-13 começando com 2, com o código do produto dentro)
 * e barras que são o próprio coditem zero-preenchido contam como "igual".
 *
 * Diferente do backfill (#138), aqui o cadastro NÃO é respeitado: quem já
 * dizia `N` vira `S`, e vice-versa. Por isso a ação é separada, com frase
 * própria, e a prévia conta quantos mudam de lado — é esse número que a
 * pessoa olha.
 *
 * O espelho entra pelo mesmo casamento que o gerador usa (`creare.service`):
 * código de barras primeiro, coditem depois. Se o espelho não for corrigido,
 * o gerador recusa o produto por "Pesavel diverge" e o TXT sai sem ele.
 */

export interface ProdutoAtivoParaPadronizar {
  id: string;
  codigoInterno: string | null;
  codigoBarras: string | null;
  nome: string;
  pesavel: string | null;
  teclaBalanca: number | null;
  validadeBalanca: number | null;
}

export interface EspelhoParaPadronizar {
  id: string;
  coditem: string;
  chaveBarras: string;
  pesavel: string | null;
  teclaBalanca: string | null;
  validadeBalanca: string | null;
}

export interface PadraoPesavel {
  pesavel: 'S' | 'N';
  teclaBalanca: number;
  validadeBalanca: number;
}

/** O padrão pedido em 06/10/2026: pesável, tecla 000, cinco dias de validade. */
export const PADRAO_TODOS_PESAVEIS: PadraoPesavel = { pesavel: 'S', teclaBalanca: 0, validadeBalanca: 5 };
/** O que recebe quem tem código de barras próprio: não pesável, sem tecla, sem validade. */
export const NAO_PESAVEL: PadraoPesavel = { pesavel: 'N', teclaBalanca: 0, validadeBalanca: 0 };

/**
 * O que fazer com quem tem código de barras próprio (diferente do código interno).
 * - `pesavel`: entra no padrão como todo mundo (comportamento da #140).
 * - `naoPesavel`: fica `N`, porque a balança não aceita código acima de 999999
 *   (decisão do José e do Petterson em 06/10/2026).
 */
export type RegraBarrasProprias = 'pesavel' | 'naoPesavel';

export interface OpcoesPadronizacao {
  barrasProprias: RegraBarrasProprias;
}

export const OPCOES_PADRAO_PADRONIZACAO: OpcoesPadronizacao = { barrasProprias: 'pesavel' };

export interface MudancaProduto {
  produto: ProdutoAtivoParaPadronizar;
  antes: { pesavel: string | null; teclaBalanca: number | null; validadeBalanca: number | null };
  depois: PadraoPesavel;
}

export interface MudancaEspelho {
  espelhoId: string;
  coditem: string;
  codigoInterno: string;
  nome: string;
  antes: { pesavel: string | null; teclaBalanca: string | null; validadeBalanca: string | null };
  /** Como fica, já no formato texto do espelho (`000`, `5`). */
  depois: { pesavel: 'S' | 'N'; teclaBalanca: string; validadeBalanca: string };
}

export interface PlanoPadronizacao {
  padrao: PadraoPesavel;
  opcoes: OpcoesPadronizacao;
  totalAtivos: number;
  /** Produtos que mudam em pelo menos um dos três campos. */
  gravar: MudancaProduto[];
  /** Já estavam exatamente no alvo deles: intocados. */
  jaNoPadrao: number;
  /** Dos que mudam, quantos diziam o contrário do alvo (o número que importa). */
  invertidos: number;
  /** Dos que mudam, quantos não diziam nada. */
  semValor: number;
  /** Ativos com código de barras próprio (diferente do código interno). */
  barrasProprias: number;
  /** Dos que mudam, quantos vão para S e quantos para N. */
  paraS: number;
  paraN: number;
  /** Linhas do espelho SIA casadas com um ativo que ainda não dizem o alvo dele. */
  espelhoCorrigir: MudancaEspelho[];
  /** Linhas do espelho casadas que já dizem o alvo. */
  espelhoJaNoPadrao: number;
  /** Ativos sem nenhuma linha no espelho: o gerador usa só o cadastro, nada a corrigir. */
  semEspelho: number;
}

export const espelhoTexto = (padrao: PadraoPesavel) => ({
  pesavel: padrao.pesavel,
  teclaBalanca: padrao.pesavel === 'S' ? String(padrao.teclaBalanca).padStart(3, '0') : '0',
  validadeBalanca: String(padrao.pesavel === 'S' ? padrao.validadeBalanca : 0),
});

const numeroOuNulo = (valor: string | null): number | null => {
  if (valor === null || valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/**
 * Código de barras próprio: tem barras, e nenhuma leitura delas (inteira, ou o
 * código embutido numa etiqueta de balança) é o código interno do produto.
 */
export function temBarrasProprias(produto: Pick<ProdutoAtivoParaPadronizar, 'codigoInterno' | 'codigoBarras'>): boolean {
  const candidatos = barcodeCandidates(produto.codigoBarras);
  if (candidatos.length === 0) return false;
  const interno = codigoSia(produto.codigoInterno);
  return interno === null || !candidatos.includes(interno);
}

export function planejarPadronizacao(
  produtos: ProdutoAtivoParaPadronizar[],
  espelhos: EspelhoParaPadronizar[],
  padrao: PadraoPesavel = PADRAO_TODOS_PESAVEIS,
  opcoes: OpcoesPadronizacao = OPCOES_PADRAO_PADRONIZACAO,
): PlanoPadronizacao {
  const plano: PlanoPadronizacao = {
    padrao, opcoes, totalAtivos: produtos.length, gravar: [], jaNoPadrao: 0, invertidos: 0, semValor: 0,
    barrasProprias: 0, paraS: 0, paraN: 0, espelhoCorrigir: [], espelhoJaNoPadrao: 0, semEspelho: 0,
  };

  const alvoDe = new Map<string, PadraoPesavel>();
  for (const produto of produtos) {
    const proprias = temBarrasProprias(produto);
    if (proprias) plano.barrasProprias += 1;
    const alvo = proprias && opcoes.barrasProprias === 'naoPesavel' ? NAO_PESAVEL : padrao;
    alvoDe.set(produto.id, alvo);
    const igual = produto.pesavel === alvo.pesavel
      && produto.teclaBalanca === alvo.teclaBalanca
      && produto.validadeBalanca === alvo.validadeBalanca;
    if (igual) { plano.jaNoPadrao += 1; continue; }
    plano.gravar.push({
      produto,
      antes: { pesavel: produto.pesavel, teclaBalanca: produto.teclaBalanca, validadeBalanca: produto.validadeBalanca },
      depois: alvo,
    });
    if (alvo.pesavel === 'S') plano.paraS += 1; else plano.paraN += 1;
    if (produto.pesavel === 'S' || produto.pesavel === 'N') {
      if (produto.pesavel !== alvo.pesavel) plano.invertidos += 1;
    } else {
      plano.semValor += 1;
    }
  }

  // O mesmo casamento do gerador: barras primeiro, coditem depois. Cada linha
  // do espelho é corrigida uma vez só, mesmo que dois ativos apontem para ela.
  const porBarras = new Map<string, EspelhoParaPadronizar>();
  const porCoditem = new Map<string, EspelhoParaPadronizar[]>();
  for (const e of espelhos) {
    if (e.chaveBarras) porBarras.set(e.chaveBarras, e);
    const codigo = codigoSia(e.coditem);
    if (codigo) porCoditem.set(codigo, [...(porCoditem.get(codigo) ?? []), e]);
  }
  const vistos = new Set<string>();
  for (const produto of produtos) {
    const alvo = espelhoTexto(alvoDe.get(produto.id)!);
    const casados: EspelhoParaPadronizar[] = [];
    for (const chave of barcodeCandidates(produto.codigoBarras)) {
      const linha = porBarras.get(chave);
      if (linha) casados.push(linha);
    }
    const codigo = codigoSia(produto.codigoInterno);
    if (codigo) casados.push(...(porCoditem.get(codigo) ?? []));
    if (casados.length === 0) { plano.semEspelho += 1; continue; }
    for (const e of casados) {
      if (vistos.has(e.id)) continue;
      vistos.add(e.id);
      const igual = e.pesavel === alvo.pesavel
        && numeroOuNulo(e.teclaBalanca) === Number(alvo.teclaBalanca)
        && numeroOuNulo(e.validadeBalanca) === Number(alvo.validadeBalanca);
      if (igual) { plano.espelhoJaNoPadrao += 1; continue; }
      plano.espelhoCorrigir.push({
        espelhoId: e.id, coditem: e.coditem, codigoInterno: codigo ?? produto.codigoInterno ?? '', nome: produto.nome,
        antes: { pesavel: e.pesavel, teclaBalanca: e.teclaBalanca, validadeBalanca: e.validadeBalanca },
        depois: alvo,
      });
    }
  }

  return plano;
}
