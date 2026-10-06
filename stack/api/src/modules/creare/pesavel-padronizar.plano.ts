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
 * Diferente do backfill (#138), aqui o cadastro NÃO é respeitado: quem já
 * dizia `N` vira `S`. Por isso a ação é separada, com frase própria, e a
 * prévia conta quantos deixam de ser `N` — é esse número que a pessoa olha.
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

export interface MudancaProduto {
  produto: ProdutoAtivoParaPadronizar;
  antes: { pesavel: string | null; teclaBalanca: number | null; validadeBalanca: number | null };
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
  totalAtivos: number;
  /** Produtos que mudam em pelo menos um dos três campos. */
  gravar: MudancaProduto[];
  /** Já estavam exatamente no padrão: intocados. */
  jaNoPadrao: number;
  /** Dos que mudam, quantos diziam o contrário do padrão (o número que importa). */
  invertidos: number;
  /** Dos que mudam, quantos não diziam nada. */
  semValor: number;
  /** Linhas do espelho SIA casadas com um ativo que ainda não dizem o padrão. */
  espelhoCorrigir: MudancaEspelho[];
  /** Linhas do espelho casadas que já dizem o padrão. */
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

export function planejarPadronizacao(
  produtos: ProdutoAtivoParaPadronizar[],
  espelhos: EspelhoParaPadronizar[],
  padrao: PadraoPesavel = PADRAO_TODOS_PESAVEIS,
): PlanoPadronizacao {
  const plano: PlanoPadronizacao = {
    padrao, totalAtivos: produtos.length, gravar: [], jaNoPadrao: 0, invertidos: 0, semValor: 0,
    espelhoCorrigir: [], espelhoJaNoPadrao: 0, semEspelho: 0,
  };

  for (const produto of produtos) {
    const igual = produto.pesavel === padrao.pesavel
      && produto.teclaBalanca === padrao.teclaBalanca
      && produto.validadeBalanca === padrao.validadeBalanca;
    if (igual) { plano.jaNoPadrao += 1; continue; }
    plano.gravar.push({
      produto,
      antes: { pesavel: produto.pesavel, teclaBalanca: produto.teclaBalanca, validadeBalanca: produto.validadeBalanca },
    });
    if (produto.pesavel === 'S' || produto.pesavel === 'N') {
      if (produto.pesavel !== padrao.pesavel) plano.invertidos += 1;
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
  const alvo = espelhoTexto(padrao);
  const vistos = new Set<string>();
  for (const produto of produtos) {
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
