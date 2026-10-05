import { createHash } from 'node:crypto';
import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { AppError } from '@/config/api.replies';
import { db, type Tx } from '@/db/databases';
import {
  planejarBackfill, type DecisaoBackfill, type EspelhoParaBackfill, type PlanoBackfill, type ProdutoParaBackfill,
} from './pesavel-backfill.plano';

export type LojaBackfill = 'TNP' | 'LI';
export const CONFIRMACAO_BACKFILL = (loja: LojaBackfill) => `CLASSIFICAR PESAVEL ${loja}`;

const digest = (valor: string) => createHash('sha256').update(valor).digest('hex');

export interface PreviaBackfill {
  loja: LojaBackfill;
  totalProdutos: number;
  gravar: number;
  porOrigem: PlanoBackfill['porOrigem'];
  completarBalanca: number;
  jaDefinidos: number;
  conflitos: PlanoBackfill['conflitos'];
  espelhoAmbiguo: string[];
  espelhoIncompleto: string[];
  /** Alguns que vão virar `S` pelo espelho, para a conferência não ser só contagem. */
  amostraPesaveis: Array<{ codigoInterno: string; nome: string; validadeDias: number }>;
  hashPlano: string;
  confirmacao: string;
}

/**
 * Backfill de pesável no catálogo de uma loja.
 *
 * Mesma disciplina da manutenção de pesáveis (#136): prévia que não grava,
 * frase de confirmação, transação com `FOR UPDATE` e hash do estado visto na
 * prévia — se alguém mexeu no cadastro entre conferir e aplicar, 409 e nada
 * grava. Conflito entre cadastro e espelho bloqueia o lote inteiro: ninguém
 * decide por um produto que já tem duas respostas.
 */
@injectable()
export class PesavelBackfillService {
  private async estado(tx: Tx, loja: LojaBackfill, bloquear: boolean) {
    const trava = bloquear ? sql`FOR UPDATE` : sql``;
    const [p, e] = await Promise.all([
      tx.execute(sql`SELECT id, codigo_interno AS "codigoInterno", nome, pesavel,
          tecla_balanca AS "teclaBalanca", validade_balanca AS "validadeBalanca"
        FROM products WHERE loja = ${loja} AND status <> 'unificado' ORDER BY id ${trava}`),
      tx.execute(sql`SELECT coditem, pesavel, tecla_balanca AS "teclaBalanca",
          validade_balanca AS "validadeBalanca"
        FROM sia_produto_depara WHERE loja = ${loja} ORDER BY coditem`),
    ]);
    return {
      produtos: p.rows as unknown as ProdutoParaBackfill[],
      espelhos: e.rows as unknown as EspelhoParaBackfill[],
    };
  }

  private async calcular(tx: Tx, loja: LojaBackfill, bloquear: boolean) {
    const estado = await this.estado(tx, loja, bloquear);
    const plano = planejarBackfill(estado.produtos, estado.espelhos);
    // O hash cobre o que o plano LEU, não o que ele decidiu: é o estado dos
    // cadastros que não pode ter mudado entre a prévia e o clique.
    const hashPlano = digest(JSON.stringify(estado));
    return { estado, plano, hashPlano };
  }

  private resumo(loja: LojaBackfill, total: number, plano: PlanoBackfill, hashPlano: string): PreviaBackfill {
    return {
      loja,
      totalProdutos: total,
      gravar: plano.gravar.length,
      porOrigem: plano.porOrigem,
      completarBalanca: plano.completarBalanca.length,
      jaDefinidos: plano.jaDefinidos,
      conflitos: plano.conflitos.slice(0, 50),
      espelhoAmbiguo: plano.espelhoAmbiguo.slice(0, 50),
      espelhoIncompleto: plano.espelhoIncompleto.slice(0, 50),
      amostraPesaveis: plano.gravar
        .filter((g) => g.pesavel === 'S')
        .slice(0, 5)
        .map((g) => ({ codigoInterno: g.produto.codigoInterno ?? '', nome: g.produto.nome, validadeDias: g.validadeBalanca })),
      hashPlano,
      confirmacao: CONFIRMACAO_BACKFILL(loja),
    };
  }

  async previa(loja: LojaBackfill): Promise<PreviaBackfill> {
    const { estado, plano, hashPlano } = await this.calcular(db, loja, false);
    return this.resumo(loja, estado.produtos.length, plano, hashPlano);
  }

  async aplicar(loja: LojaBackfill, confirmacao: string, hashPlano: string) {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_BACKFILL(loja)) {
      throw new AppError(`Digite exatamente ${CONFIRMACAO_BACKFILL(loja)}.`, 400);
    }
    return db.transaction(async (tx) => {
      const atual = await this.calcular(tx, loja, true);
      if (hashPlano !== atual.hashPlano) {
        throw new AppError('Os cadastros mudaram desde a prévia. Confira novamente; nada foi gravado.', 409);
      }
      const { plano } = atual;
      if (plano.conflitos.length || plano.espelhoAmbiguo.length) {
        throw new AppError(
          'Há produtos em que cadastro e espelho discordam, ou espelhos ambíguos. Resolva-os antes; nada foi gravado.',
          422, 'PESAVEL_BACKFILL_CONFLITO',
        );
      }
      const gravar = async (decisoes: DecisaoBackfill[]) => {
        for (const d of decisoes) {
          await tx.execute(sql`UPDATE products SET pesavel = ${d.pesavel},
            tecla_balanca = ${d.teclaBalanca}, validade_balanca = ${d.validadeBalanca}
            WHERE id = ${d.produto.id}`);
        }
      };
      await gravar(plano.gravar);
      await gravar(plano.completarBalanca);
      return {
        loja,
        gravados: plano.gravar.length,
        porOrigem: plano.porOrigem,
        completados: plano.completarBalanca.length,
        jaDefinidos: plano.jaDefinidos,
        espelhoIncompleto: plano.espelhoIncompleto.length,
      };
    });
  }
}
