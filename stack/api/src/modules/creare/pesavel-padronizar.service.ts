import { createHash } from 'node:crypto';
import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { AppError } from '@/config/api.replies';
import { db, type Tx } from '@/db/databases';
import {
  PADRAO_TODOS_PESAVEIS, planejarPadronizacao, type EspelhoParaPadronizar, type PadraoPesavel, type PlanoPadronizacao,
  type ProdutoAtivoParaPadronizar,
} from './pesavel-padronizar.plano';

export type LojaPadronizar = 'TNP' | 'LI';
export const CONFIRMACAO_PADRONIZAR = (loja: LojaPadronizar) => `TODOS PESAVEIS ${loja}`;

const digest = (valor: string) => createHash('sha256').update(valor).digest('hex');

export interface PreviaPadronizacao {
  loja: LojaPadronizar;
  padrao: PadraoPesavel;
  totalAtivos: number;
  gravar: number;
  jaNoPadrao: number;
  invertidos: number;
  semValor: number;
  espelhoCorrigir: number;
  espelhoJaNoPadrao: number;
  semEspelho: number;
  /** Alguns dos que deixam de ser N, para a conferência não ser só contagem. */
  amostraInvertidos: Array<{ codigoInterno: string; nome: string }>;
  hashPlano: string;
  confirmacao: string;
}

/**
 * Padroniza pesável em todos os ativos de uma loja (decisão de 06/10/2026).
 *
 * Mesma disciplina das outras ações de Manutenção: prévia que não grava,
 * frase de confirmação própria, transação com `FOR UPDATE` e hash do estado
 * lido na prévia — mudou alguém o cadastro entre conferir e clicar, 409 e nada
 * grava. Só produtos `status = 'ativo'`: inativo e unificado ficam como estão,
 * senão o TXT dos inativos passa a divergir do espelho deles.
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

  private async calcular(tx: Tx, loja: LojaPadronizar, bloquear: boolean, padrao: PadraoPesavel) {
    const estado = await this.estado(tx, loja, bloquear);
    const plano = planejarPadronizacao(estado.produtos, estado.espelhos, padrao);
    const hashPlano = digest(JSON.stringify({ estado, padrao }));
    return { plano, hashPlano };
  }

  private resumo(loja: LojaPadronizar, plano: PlanoPadronizacao, hashPlano: string): PreviaPadronizacao {
    return {
      loja,
      padrao: plano.padrao,
      totalAtivos: plano.totalAtivos,
      gravar: plano.gravar.length,
      jaNoPadrao: plano.jaNoPadrao,
      invertidos: plano.invertidos,
      semValor: plano.semValor,
      espelhoCorrigir: plano.espelhoCorrigir.length,
      espelhoJaNoPadrao: plano.espelhoJaNoPadrao,
      semEspelho: plano.semEspelho,
      amostraInvertidos: plano.gravar
        .filter((g) => g.antes.pesavel && g.antes.pesavel !== plano.padrao.pesavel)
        .slice(0, 8)
        .map((g) => ({ codigoInterno: g.produto.codigoInterno ?? '', nome: g.produto.nome })),
      hashPlano,
      confirmacao: CONFIRMACAO_PADRONIZAR(loja),
    };
  }

  async previa(loja: LojaPadronizar, padrao: PadraoPesavel = PADRAO_TODOS_PESAVEIS): Promise<PreviaPadronizacao> {
    const { plano, hashPlano } = await this.calcular(db, loja, false, padrao);
    return this.resumo(loja, plano, hashPlano);
  }

  async aplicar(loja: LojaPadronizar, confirmacao: string, hashPlano: string, padrao: PadraoPesavel = PADRAO_TODOS_PESAVEIS) {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_PADRONIZAR(loja)) {
      throw new AppError(`Digite exatamente ${CONFIRMACAO_PADRONIZAR(loja)}.`, 400);
    }
    return db.transaction(async (tx) => {
      const atual = await this.calcular(tx, loja, true, padrao);
      if (hashPlano !== atual.hashPlano) {
        throw new AppError('Os cadastros mudaram desde a prévia. Confira novamente; nada foi gravado.', 409);
      }
      const { plano } = atual;
      // Um UPDATE por lote de ids: 2.351 ativos na TNP em 06/10/2026 não
      // precisam de 2.351 idas ao banco dentro da transação.
      const lotes = <T,>(itens: T[], tamanho = 500) =>
        Array.from({ length: Math.ceil(itens.length / tamanho) }, (_, i) => itens.slice(i * tamanho, (i + 1) * tamanho));
      const lista = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
      for (const lote of lotes(plano.gravar.map((g) => g.produto.id))) {
        await tx.execute(sql`UPDATE products SET pesavel = ${padrao.pesavel},
          tecla_balanca = ${padrao.teclaBalanca}, validade_balanca = ${padrao.validadeBalanca}
          WHERE id IN (${lista(lote)})`);
      }
      if (plano.espelhoCorrigir.length) {
        const alvo = plano.espelhoCorrigir[0]!.depois;
        for (const lote of lotes(plano.espelhoCorrigir.map((c) => c.espelhoId))) {
          await tx.execute(sql`UPDATE sia_produto_depara SET pesavel = ${alvo.pesavel},
            tecla_balanca = ${alvo.teclaBalanca}, validade_balanca = ${alvo.validadeBalanca}
            WHERE id IN (${lista(lote)})`);
        }
      }
      return {
        loja,
        gravados: plano.gravar.length,
        invertidos: plano.invertidos,
        semValor: plano.semValor,
        jaNoPadrao: plano.jaNoPadrao,
        espelhosCorrigidos: plano.espelhoCorrigir.length,
        semEspelho: plano.semEspelho,
      };
    });
  }
}
