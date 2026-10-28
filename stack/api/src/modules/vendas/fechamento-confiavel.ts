import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';

type Loja = 'TNP' | 'LI';

/**
 * QUANDO o fechamento de caixa de um dia merece confiança.
 *
 * O fechamento é a fonte oficial de faturamento, número de vendas e turno — mas
 * só quando chega inteiro. Desde 02/01/2026 a consulta do robô no CREARE
 * (`formapgto_venda_balcao`) devolve 4 a 8 vendas por dia, contra ~1.400 reais:
 * os PDVs novos gravam o pagamento em outro lugar. O dado chega a cada minuto,
 * só que quase vazio, e Relatório, Gerentes e Metas passaram a mostrar R$ 100
 * num dia de R$ 20 mil (diagnóstico de 28/10/2026).
 *
 * A régua compara com os produtos vendidos no MESMO dia (`venda_produto_dia`).
 * Num dia normal os dois ficam a poucos por cento um do outro (15/10/2025:
 * fechamento R$ 21.204, itens R$ 21.586 = 98%); no dia quebrado o fechamento é
 * menos de 1%. Metade separa os dois com folga e não depende de desconto ou
 * cancelamento. Quando o robô voltar a mandar o fechamento inteiro, a régua
 * passa sozinha e o fechamento volta a ser a fonte — sem mexer em código.
 */
export const PROPORCAO_MINIMA_FECHAMENTO = 0.5;

export function fechamentoIncompleto(totalFechamento: number, totalItens: number): boolean {
  return totalItens > 0 && totalFechamento < totalItens * PROPORCAO_MINIMA_FECHAMENTO;
}

/** Dias do período cujo fechamento chegou, mas chegou incompleto. */
export async function diasFechamentoIncompleto(loja: Loja, inicio: string, fim: string): Promise<string[]> {
  const result = await db.execute(sql`
    WITH f AS (
      SELECT data, SUM(total_pagamento)::float8 AS total
        FROM fechamento_caixa_dia
       WHERE loja = ${loja} AND data BETWEEN ${inicio}::date AND ${fim}::date
       GROUP BY data
    ), i AS (
      SELECT data, SUM(total)::float8 AS total
        FROM venda_produto_dia
       WHERE loja = ${loja} AND data BETWEEN ${inicio}::date AND ${fim}::date
       GROUP BY data
    )
    SELECT f.data::text AS data, f.total AS fechamento, i.total AS itens
      FROM f JOIN i USING (data)
     ORDER BY f.data
  `);
  return result.rows
    .filter((row) => fechamentoIncompleto(Number(row.fechamento ?? 0), Number(row.itens ?? 0)))
    .map((row) => String(row.data));
}
