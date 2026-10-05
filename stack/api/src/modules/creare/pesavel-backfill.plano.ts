import { codigoSia } from './pesaveis-exportacao';

/**
 * Plano do backfill de pesável nos produtos de uma loja.
 *
 * Em 05/10/2026, 6.823 de 7.177 produtos da TNP (95%) não exportavam para o
 * SIA por um motivo só: `Pesavel sem confirmacao`. O gerador exige pesável no
 * cadastro do Pralis OU no espelho SIA; a carga da Base de 28/09 inseriu 7.369
 * produtos em lote, sem passar pelo caminho de criação que aplica o default.
 *
 * A regra de negócio já existe em `product/pesavel-na-criacao.ts` (PR #124):
 * produto nasce `N`. Ela proíbe, de propósito, ser aplicada em backfill sem
 * decisão — e a decisão veio do José em 05/10/2026: "pode executar".
 *
 * Ordem de verdade, da mais forte para a mais fraca:
 *   1. o produto já diz — não se toca;
 *   2. o espelho SIA diz — copia-se, inclusive tecla e validade;
 *   3. ninguém diz — `N`, tecla 0, validade 0.
 *
 * Nada aqui usa nome, unidade ou código de barras para decidir. Só código
 * interno exato contra o `coditem` do espelho.
 */

export interface ProdutoParaBackfill {
  id: string;
  codigoInterno: string | null;
  nome: string;
  pesavel: string | null;
  teclaBalanca: number | null;
  validadeBalanca: number | null;
}

export interface EspelhoParaBackfill {
  coditem: string;
  pesavel: string | null;
  teclaBalanca: string | null;
  validadeBalanca: string | null;
}

export type OrigemDecisao = 'espelho' | 'padrao';

export interface DecisaoBackfill {
  produto: ProdutoParaBackfill;
  origem: OrigemDecisao;
  pesavel: 'S' | 'N';
  teclaBalanca: number;
  validadeBalanca: number;
}

export interface PlanoBackfill {
  /** Produtos que vão receber valor. */
  gravar: DecisaoBackfill[];
  /** Já tinham pesável próprio: intocados. */
  jaDefinidos: number;
  /** Pesável `S` já definido, mas sem tecla/validade, e o espelho completa. */
  completarBalanca: DecisaoBackfill[];
  /** Dizem `S` no cadastro e `N` no espelho, ou vice-versa: ninguém decide por eles. */
  conflitos: Array<{ codigoInterno: string; nome: string; cadastro: string; espelho: string }>;
  /** Dois espelhos normalizando para o mesmo código: ambíguo, fica de fora. */
  espelhoAmbiguo: string[];
  /** Espelho diz `S` mas sem tecla/validade: não se grava S pela metade; fica para o de-para completo. */
  espelhoIncompleto: string[];
  porOrigem: Record<OrigemDecisao, number>;
}

const inteiro = (valor: string | null): number | null => {
  if (valor === null) return null;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

export function planejarBackfill(
  produtos: ProdutoParaBackfill[], espelhos: EspelhoParaBackfill[],
): PlanoBackfill {
  const espelhoPorCodigo = new Map<string, EspelhoParaBackfill[]>();
  for (const e of espelhos) {
    const codigo = codigoSia(e.coditem);
    if (codigo) espelhoPorCodigo.set(codigo, [...(espelhoPorCodigo.get(codigo) ?? []), e]);
  }

  const plano: PlanoBackfill = {
    gravar: [], jaDefinidos: 0, completarBalanca: [], conflitos: [], espelhoAmbiguo: [], espelhoIncompleto: [],
    porOrigem: { espelho: 0, padrao: 0 },
  };

  for (const produto of produtos) {
    const codigo = codigoSia(produto.codigoInterno);
    const candidatos = codigo ? espelhoPorCodigo.get(codigo) ?? [] : [];
    if (candidatos.length > 1) { plano.espelhoAmbiguo.push(codigo!); continue; }
    const espelho = candidatos[0] ?? null;
    const espelhoDiz = espelho?.pesavel === 'S' || espelho?.pesavel === 'N' ? espelho.pesavel : null;

    if (produto.pesavel === 'S' || produto.pesavel === 'N') {
      // O cadastro já decidiu. Só se mexe se ele e o espelho se contradizem —
      // e aí não se mexe, avisa — ou se é S sem tecla/validade e o espelho completa.
      if (espelhoDiz && espelhoDiz !== produto.pesavel) {
        plano.conflitos.push({
          codigoInterno: codigo ?? produto.codigoInterno ?? '', nome: produto.nome,
          cadastro: produto.pesavel, espelho: espelhoDiz,
        });
        continue;
      }
      const faltaBalanca = produto.pesavel === 'S'
        && (produto.teclaBalanca === null || produto.validadeBalanca === null);
      if (faltaBalanca && espelho) {
        const tecla = produto.teclaBalanca ?? inteiro(espelho.teclaBalanca);
        const validade = produto.validadeBalanca ?? inteiro(espelho.validadeBalanca);
        if (tecla !== null && validade !== null) {
          plano.completarBalanca.push({ produto, origem: 'espelho', pesavel: 'S', teclaBalanca: tecla, validadeBalanca: validade });
          continue;
        }
      }
      plano.jaDefinidos += 1;
      continue;
    }

    if (espelhoDiz) {
      const tecla = inteiro(espelho!.teclaBalanca);
      const validade = inteiro(espelho!.validadeBalanca);
      // Espelho S sem tecla/validade não serve para exportar; melhor não gravar
      // S pela metade — fica para o de-para completo resolver.
      if (espelhoDiz === 'S' && (tecla === null || validade === null)) { plano.espelhoIncompleto.push(codigo!); continue; }
      plano.gravar.push({
        produto, origem: 'espelho', pesavel: espelhoDiz,
        teclaBalanca: espelhoDiz === 'S' ? tecla! : 0,
        validadeBalanca: espelhoDiz === 'S' ? validade! : 0,
      });
      plano.porOrigem.espelho += 1;
      continue;
    }

    plano.gravar.push({ produto, origem: 'padrao', pesavel: 'N', teclaBalanca: 0, validadeBalanca: 0 });
    plano.porOrigem.padrao += 1;
  }

  return plano;
}
