import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import type { VendasSchemas } from '@pralis/shared';

type PagamentoDia = VendasSchemas.PagamentoDia;
type ProdutoRanking = VendasSchemas.ProdutoRanking;

type Loja = 'TNP' | 'LI';
const n = (value: unknown): number => Number(value ?? 0);

@injectable()
export class VendasReportRepository {
  async resumo(loja: Loja, inicio: string, fim: string) {
    const vendas = await db.execute(sql`
      SELECT COALESCE(SUM(total), 0) AS faturamento,
             COALESCE(SUM(quantidade), 0) AS quantidade,
             COUNT(*) FILTER (WHERE produto_codigo = '')::int AS sem_codigo,
             COALESCE(SUM(total) FILTER (WHERE produto_codigo = ''), 0) AS faturamento_sem_codigo
      FROM venda_produto_dia
      WHERE loja = ${loja} AND data BETWEEN ${inicio}::date AND ${fim}::date
    `);
    const caixas = await db.execute(sql`
      SELECT COALESCE(SUM(numero_vendas), 0)::int AS numero_vendas,
             COALESCE(SUM(total_pagamento), 0) AS total_pagamentos,
             COALESCE(SUM(outros), 0) AS outros
      FROM fechamento_caixa_dia
      WHERE loja = ${loja} AND data BETWEEN ${inicio}::date AND ${fim}::date
    `);
    const sale = vendas.rows[0] ?? {};
    const closing = caixas.rows[0] ?? {};
    return {
      faturamento: n(sale.faturamento), quantidade: n(sale.quantidade),
      produtosSemCodigo: n(sale.sem_codigo), faturamentoSemCodigo: n(sale.faturamento_sem_codigo),
      numeroVendas: n(closing.numero_vendas), totalPagamentos: n(closing.total_pagamentos),
      outrosPagamento: n(closing.outros),
    };
  }

  async produtos(loja: Loja, inicio: string, fim: string): Promise<ProdutoRanking[]> {
    const result = await db.execute(sql`
      SELECT produto_codigo, produto, SUM(quantidade) AS quantidade, SUM(total) AS faturamento
      FROM venda_produto_dia
      WHERE loja = ${loja} AND data BETWEEN ${inicio}::date AND ${fim}::date
      GROUP BY produto_codigo, produto
      ORDER BY SUM(total) DESC, produto
    `);
    return result.rows.map((row) => ({
      produtoCodigo: String(row.produto_codigo ?? ''),
      produto: String(row.produto ?? ''),
      quantidade: n(row.quantidade),
      faturamento: n(row.faturamento),
    }));
  }

  async pagamentos(loja: Loja, inicio: string, fim: string): Promise<PagamentoDia[]> {
    const result = await db.execute(sql`
      SELECT data::text AS data,
             SUM(numero_vendas)::int AS numero_vendas,
             SUM(dinheiro) AS dinheiro, SUM(debito) AS debito, SUM(credito) AS credito,
             SUM(pix) AS pix, SUM(voucher) AS voucher, SUM(crediario) AS crediario,
             SUM(clientes) AS clientes, SUM(colaboradores) AS colaboradores,
             SUM(alimentacao) AS alimentacao, SUM(roubo_furto) AS roubo_furto,
             SUM(socios) AS socios, SUM(sobra_perda) AS sobra_perda,
             SUM(outros) AS outros, SUM(total_pagamento) AS total
      FROM fechamento_caixa_dia
      WHERE loja = ${loja} AND data BETWEEN ${inicio}::date AND ${fim}::date
      GROUP BY data ORDER BY data
    `);
    return result.rows.map((row) => ({
      data: String(row.data), numeroVendas: n(row.numero_vendas),
      dinheiro: n(row.dinheiro), debito: n(row.debito), credito: n(row.credito), pix: n(row.pix),
      voucher: n(row.voucher), crediario: n(row.crediario), clientes: n(row.clientes),
      colaboradores: n(row.colaboradores), alimentacao: n(row.alimentacao), rouboFurto: n(row.roubo_furto),
      socios: n(row.socios), sobraPerda: n(row.sobra_perda), outros: n(row.outros), total: n(row.total),
    }));
  }
}

