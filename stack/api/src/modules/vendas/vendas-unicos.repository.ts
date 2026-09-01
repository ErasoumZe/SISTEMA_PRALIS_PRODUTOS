import { injectable } from 'tsyringe';
import { SQL, sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import type { VendasUnicos } from '@pralis/shared';

type Loja = 'TNP' | 'LI';
const n = (v: unknown): number => Number(v ?? 0);

/**
 * Chave de agrupamento: a identidade do ERP quando existe, senão o par
 * (código, nome). Sem o `produto_id_erp`, um produto renomeado no PDV durante o
 * período apareceria duas vezes — que é exatamente o defeito que esta tela
 * existe para não ter.
 */
const CHAVE = sql`COALESCE(NULLIF(produto_id_erp, ''), produto_codigo || '|' || produto)`;

/** Whitelist: a ordenação vem da URL e nunca é interpolada como texto. */
const ORDENACAO: Record<VendasUnicos.OrdenarPor, SQL> = {
  faturamento: sql`SUM(total) DESC, produto ASC`,
  quantidade: sql`SUM(quantidade) DESC, produto ASC`,
  nome: sql`(array_agg(produto ORDER BY data DESC))[1] ASC`,
};

@injectable()
export class VendasUnicosRepository {
  private filtro(loja: Loja, inicio: string, fim: string, busca?: string): SQL {
    const base = sql`loja = ${loja} AND data BETWEEN ${inicio}::date AND ${fim}::date`;
    return busca ? sql`${base} AND produto ILIKE ${'%' + busca + '%'}` : base;
  }

  /** Quantos produtos distintos e quanto somam — antes de paginar. */
  async totais(loja: Loja, inicio: string, fim: string, busca?: string) {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int AS total,
             COALESCE(SUM(quantidade), 0) AS quantidade,
             COALESCE(SUM(faturamento), 0) AS faturamento
        FROM (
          SELECT SUM(quantidade) AS quantidade, SUM(total) AS faturamento
            FROM venda_produto_dia
           WHERE ${this.filtro(loja, inicio, fim, busca)}
           GROUP BY ${CHAVE}
        ) agrupado
    `);
    const row = r.rows[0] ?? {};
    return { total: n(row.total), quantidade: n(row.quantidade), faturamento: n(row.faturamento) };
  }

  /** Linhas de venda sem identidade do ERP — o pedaço que ainda pode repetir. */
  async linhasSemIdErp(loja: Loja, inicio: string, fim: string): Promise<number> {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int AS sem
        FROM venda_produto_dia
       WHERE loja = ${loja} AND data BETWEEN ${inicio}::date AND ${fim}::date
         AND produto_id_erp = ''
    `);
    return n(r.rows[0]?.sem);
  }

  /**
   * Uma linha por produto. O nome exibido é o da venda MAIS RECENTE — é o nome
   * que o produto tem hoje no PDV, não o primeiro nem o alfabético.
   * `limite` nulo devolve o período inteiro (usado na exportação).
   */
  async listar(
    loja: Loja, inicio: string, fim: string,
    opcoes: { ordenar: VendasUnicos.OrdenarPor; busca?: string; limite: number | null; offset: number },
  ): Promise<VendasUnicos.ProdutoUnico[]> {
    const paginacao = opcoes.limite === null
      ? sql``
      : sql`LIMIT ${opcoes.limite} OFFSET ${opcoes.offset}`;

    const r = await db.execute(sql`
      SELECT (array_agg(produto_codigo ORDER BY data DESC))[1] AS codigo,
             (array_agg(produto ORDER BY data DESC))[1]        AS produto,
             SUM(quantidade)                                    AS quantidade,
             SUM(total)                                         AS faturamento,
             COUNT(DISTINCT data)::int                          AS dias_com_venda,
             MIN(data)::text                                    AS primeira_venda,
             MAX(data)::text                                    AS ultima_venda,
             COUNT(DISTINCT produto)::int                       AS nomes_diferentes
        FROM venda_produto_dia
       WHERE ${this.filtro(loja, inicio, fim, opcoes.busca)}
       GROUP BY ${CHAVE}
       ORDER BY ${ORDENACAO[opcoes.ordenar]}
       ${paginacao}
    `);

    return r.rows.map((row) => ({
      codigo: String(row.codigo ?? ''),
      produto: String(row.produto ?? ''),
      quantidade: n(row.quantidade),
      faturamento: n(row.faturamento),
      diasComVenda: n(row.dias_com_venda),
      primeiraVenda: String(row.primeira_venda ?? ''),
      ultimaVenda: String(row.ultima_venda ?? ''),
      nomesDiferentes: n(row.nomes_diferentes),
    }));
  }
}
