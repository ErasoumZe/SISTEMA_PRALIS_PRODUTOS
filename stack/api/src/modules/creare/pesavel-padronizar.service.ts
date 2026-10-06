import { createHash } from 'node:crypto';
import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { AppError } from '@/config/api.replies';
import { db, type Tx } from '@/db/databases';
import {
  OPCOES_PADRAO_PADRONIZACAO, PADRAO_TODOS_PESAVEIS, planejarPadronizacao,
  type EspelhoParaPadronizar, type OpcoesPadronizacao, type PadraoPesavel, type PlanoPadronizacao,
  type ProdutoAtivoParaPadronizar,
} from './pesavel-padronizar.plano';

export type LojaPadronizar = 'TNP' | 'LI';
export const CONFIRMACAO_PADRONIZAR = (loja: LojaPadronizar) => `TODOS PESAVEIS ${loja}`;

const digest = (valor: string) => createHash('sha256').update(valor).digest('hex');

export interface PreviaPadronizacao {
  loja: LojaPadronizar;
  padrao: PadraoPesavel;
  opcoes: OpcoesPadronizacao;
  totalAtivos: number;
  gravar: number;
  jaNoPadrao: number;
  invertidos: number;
  semValor: number;
  barrasProprias: number;
  paraS: number;
  paraN: number;
  espelhoCorrigir: number;
  espelhoJaNoPadrao: number;
  semEspelho: number;
  /** Alguns dos que mudam de lado para S, para a conferência não ser só contagem. */
  amostraInvertidos: Array<{ codigoInterno: string; nome: string }>;
  /** Alguns dos que vão para N por terem barras próprias, com as barras à vista. */
  amostraNaoPesaveis: Array<{ codigoInterno: string; codigoBarras: string; nome: string }>;
  hashPlano: string;
  confirmacao: string;
}

/**
 * Padroniza pesável em todos os ativos de uma loja (decisão de 06/10/2026).
 *
 * Mesma disciplina das outras ações de Manutenção: prévia que não grava,
 * frase de confirmação própria, transação com `FOR UPDATE` e hash do estado
 * lido na prévia — mudou alguém o cadastro entre conferir e clicar, 409 e nada
 * grava. O hash inclui as opções: prévia com uma regra não autoriza aplicar
 * com outra. Só produtos `status = 'ativo'`: inativo e unificado ficam como
 * estão, senão o TXT dos inativos passa a divergir do espelho deles.
 */
@injectable()
export class PesavelPadronizarService {
  private async estado(tx: Tx, loja: LojaPadronizar, bloquear: boolean) {
    const trava = bloquear ? sql`FOR UPDATE` : sql``;
    const [p, e] = await Promise.all([
      tx.execute(sql`SELECT id, codigo_interno AS "codigoInterno", codigo_barras AS "codigoBarras", nome, pesavel,
          tecla_balanca AS "teclaBalanca", validade_balanca AS "validadeBalanca"
        FROM products WHERE loja = ${loja} AND status = 'ativo' ORDER BY id ${trava}`),
      tx.execute(sql`SELECT id, coditem, chave_barras AS "chaveBarras", pesavel, tecla_balanca AS "teclaBalanca",
          validade_balanca AS "validadeBalanca"
        FROM sia_produto_depara WHERE loja = ${loja} ORDER BY id`),
    ]);
    return {
      produtos: p.rows as unknown as ProdutoAtivoParaPadronizar[],
      espelhos: e.rows as unknown as EspelhoParaPadronizar[],
    };
  }

  private async calcular(tx: Tx, loja: LojaPadronizar, bloquear: boolean, padrao: PadraoPesavel, opcoes: OpcoesPadronizacao) {
    const estado = await this.estado(tx, loja, bloquear);
    const plano = planejarPadronizacao(estado.produtos, estado.espelhos, padrao, opcoes);
    const hashPlano = digest(JSON.stringify({ estado, padrao, opcoes }));
    return { plano, hashPlano };
  }

  private resumo(loja: LojaPadronizar, plano: PlanoPadronizacao, hashPlano: string): PreviaPadronizacao {
    return {
      loja,
      padrao: plano.padrao,
      opcoes: plano.opcoes,
      totalAtivos: plano.totalAtivos,
      gravar: plano.gravar.length,
      jaNoPadrao: plano.jaNoPadrao,
      invertidos: plano.invertidos,
      semValor: plano.semValor,
      barrasProprias: plano.barrasProprias,
      paraS: plano.paraS,
      paraN: plano.paraN,
      espelhoCorrigir: plano.espelhoCorrigir.length,
      espelhoJaNoPadrao: plano.espelhoJaNoPadrao,
      semEspelho: plano.semEspelho,
      amostraInvertidos: plano.gravar
        .filter((g) => g.depois.pesavel === 'S' && g.antes.pesavel && g.antes.pesavel !== 'S')
        .slice(0, 8)
        .map((g) => ({ codigoInterno: g.produto.codigoInterno ?? '', nome: g.produto.nome })),
      amostraNaoPesaveis: plano.gravar
        .filter((g) => g.depois.pesavel === 'N')
        .slice(0, 8)
        .map((g) => ({ codigoInterno: g.produto.codigoInterno ?? '', codigoBarras: g.produto.codigoBarras ?? '', nome: g.produto.nome })),
      hashPlano,
      confirmacao: CONFIRMACAO_PADRONIZAR(loja),
    };
  }

  async previa(
    loja: LojaPadronizar, opcoes: OpcoesPadronizacao = OPCOES_PADRAO_PADRONIZACAO, padrao: PadraoPesavel = PADRAO_TODOS_PESAVEIS,
  ): Promise<PreviaPadronizacao> {
    const { plano, hashPlano } = await this.calcular(db, loja, false, padrao, opcoes);
    return this.resumo(loja, plano, hashPlano);
  }

  async aplicar(
    loja: LojaPadronizar, confirmacao: string, hashPlano: string,
    opcoes: OpcoesPadronizacao = OPCOES_PADRAO_PADRONIZACAO, padrao: PadraoPesavel = PADRAO_TODOS_PESAVEIS,
  ) {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_PADRONIZAR(loja)) {
      throw new AppError(`Digite exatamente ${CONFIRMACAO_PADRONIZAR(loja)}.`, 400);
    }
    return db.transaction(async (tx) => {
      const atual = await this.calcular(tx, loja, true, padrao, opcoes);
      if (hashPlano !== atual.hashPlano) {
        throw new AppError('Os cadastros mudaram desde a prévia. Confira novamente; nada foi gravado.', 409);
      }
      const { plano } = atual;
      // Um UPDATE por lote de ids e por alvo: 2.351 ativos na TNP em
      // 06/10/2026 não precisam de 2.351 idas ao banco dentro da transação.
      const lotes = <T,>(itens: T[], tamanho = 500) =>
        Array.from({ length: Math.ceil(itens.length / tamanho) }, (_, i) => itens.slice(i * tamanho, (i + 1) * tamanho));
      const lista = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
      for (const alvo of ['S', 'N'] as const) {
        const ids = plano.gravar.filter((g) => g.depois.pesavel === alvo).map((g) => g.produto.id);
        const valores = plano.gravar.find((g) => g.depois.pesavel === alvo)?.depois;
        for (const lote of lotes(ids)) {
          await tx.execute(sql`UPDATE products SET pesavel = ${valores!.pesavel},
            tecla_balanca = ${valores!.teclaBalanca}, validade_balanca = ${valores!.validadeBalanca}
            WHERE id IN (${lista(lote)})`);
        }
        const espelhos = plano.espelhoCorrigir.filter((c) => c.depois.pesavel === alvo);
        const texto = espelhos[0]?.depois;
        for (const lote of lotes(espelhos.map((c) => c.espelhoId))) {
          await tx.execute(sql`UPDATE sia_produto_depara SET pesavel = ${texto!.pesavel},
            tecla_balanca = ${texto!.teclaBalanca}, validade_balanca = ${texto!.validadeBalanca}
            WHERE id IN (${lista(lote)})`);
        }
      }
      return {
        loja,
        gravados: plano.gravar.length,
        paraS: plano.paraS,
        paraN: plano.paraN,
        invertidos: plano.invertidos,
        semValor: plano.semValor,
        jaNoPadrao: plano.jaNoPadrao,
        barrasProprias: plano.barrasProprias,
        espelhosCorrigidos: plano.espelhoCorrigir.length,
        semEspelho: plano.semEspelho,
      };
    });
  }
}
