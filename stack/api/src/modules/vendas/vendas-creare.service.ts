import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';

type Loja = 'TNP' | 'LI';

/** Cupom confirmado e pagamento diretamente do CREARE; nao mistura itens/fechamento. */
export async function resumoCuponsCreare(loja: Loja, inicio: string, fim: string, pdv?: string) {
  const filtro = sql`loja = ${loja} AND vendido_em >= ${inicio}::date
    AND vendido_em < (${fim}::date + INTERVAL '1 day')
    ${pdv ? sql`AND (dispositivo_id_erp = ${pdv} OR pdv = ${pdv})` : sql``}`;
  const [totais, pagamentos] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS cupons_recebidos,
      COUNT(*) FILTER (WHERE status = 'F')::int AS vendas_confirmadas,
      COUNT(*) FILTER (WHERE status = 'C')::int AS vendas_canceladas,
      COALESCE(SUM(valor_total) FILTER (WHERE status = 'F'), 0) AS faturamento,
      COALESCE(SUM(valor_pago) FILTER (WHERE status = 'F'), 0) AS valor_pago,
      MIN(vendido_em)::text AS primeira_venda, MAX(vendido_em)::text AS ultima_venda
      FROM venda_creare WHERE ${filtro}`),
    db.execute(sql`SELECT p->>'idFormaPagamento' AS forma_id, p->>'formaPagamento' AS forma,
      COUNT(DISTINCT venda_id_erp)::int AS vendas,
      COALESCE(SUM((p->>'valor')::numeric), 0) AS valor
      FROM venda_creare CROSS JOIN LATERAL jsonb_array_elements(pagamentos) AS p
      WHERE ${filtro} AND status = 'F'
      GROUP BY 1, 2 ORDER BY valor DESC`),
  ]);
  const t = totais.rows[0] ?? {};
  return {
    origem: 'creare_cupom' as const, loja, periodo: { inicio, fim }, pdv: pdv ?? null,
    cuponsRecebidos: Number(t.cupons_recebidos ?? 0),
    vendasConfirmadas: Number(t.vendas_confirmadas ?? 0),
    vendasCanceladas: Number(t.vendas_canceladas ?? 0),
    faturamento: Number(t.faturamento ?? 0), valorPago: Number(t.valor_pago ?? 0),
    primeiraVenda: t.primeira_venda == null ? null : String(t.primeira_venda),
    ultimaVenda: t.ultima_venda == null ? null : String(t.ultima_venda),
    formasPagamento: pagamentos.rows.map((p) => ({
      id: String(p.forma_id), nome: String(p.forma),
      vendas: Number(p.vendas), valor: Number(p.valor),
    })),
    aviso: 'Totais de cupons e pagamentos do CREARE. Cobertura depende do periodo sincronizado; nao equivale ao fechamento de caixa.',
  };
}
