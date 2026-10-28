import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';

type Loja = 'TNP' | 'LI';

/**
 * QUANDO o fechamento de caixa de um dia merece confiança.
 *
 * O fechamento é a fonte oficial de faturamento, número de vendas e turno — mas
 * só quando chega inteiro. Em 19/10/2026 a consulta do robô passou a mandar UMA
 * LINHA POR VENDA (para a planilha), e o Pralis, que guarda uma linha por
 * dia/PDV/operador, ficou com uma venda por operador: R$ 100 num dia de R$ 20
 * mil. O robô foi corrigido em 28/10 (soma antes de enviar), mas a régua fica:
 * o mesmo defeito pode voltar, e a LI ainda está com o robô antigo.
 *
 * O dia é INCOMPLETO quando as DUAS marcas aparecem juntas:
 *  1. o fechamento soma menos da metade dos produtos vendidos no dia
 *     (`venda_produto_dia`). Dia normal fica a poucos por cento (15/10/2025:
 *     fechamento R$ 21.204, itens R$ 21.586); o quebrado, abaixo de 1%;
 *  2. o fechamento tem menos de 3 vendas por linha. A linha de um operador
 *     inteiro tem centenas (316 num turno de 31/05/2025); a linha quebrada,
 *     uma só.
 *
 * Só a primeira não basta: item digitado errado no PDV infla os itens e
 * derrubava fechamentos certos — 1.640 kg de torta em 16/01/2026, 14.069 pães
 * doces em 23/03, R$ 2 milhões em itens em 23/07, cada um num dia de R$ 20 mil
 * com 1.200 a 1.400 vendas no fechamento.
 */
export const PROPORCAO_MINIMA_FECHAMENTO = 0.5;
export const VENDAS_POR_LINHA_MINIMO = 3;

export interface DiaParaConferir {
  totalFechamento: number;
  totalItens: number;
  /** Soma de `numero_vendas` das linhas de fechamento do dia. */
  vendas: number;
  /** Quantas linhas de fechamento (dia/PDV/operador) o dia tem. */
  linhas: number;
}

export function fechamentoIncompleto({ totalFechamento, totalItens, vendas, linhas }: DiaParaConferir): boolean {
  const valorBaixo = totalItens > 0 && totalFechamento < totalItens * PROPORCAO_MINIMA_FECHAMENTO;
  const vendaPorLinha = linhas > 0 && vendas / linhas < VENDAS_POR_LINHA_MINIMO;
  return valorBaixo && vendaPorLinha;
}

/** Dias do período cujo fechamento chegou, mas chegou incompleto. */
export async function diasFechamentoIncompleto(loja: Loja, inicio: string, fim: string): Promise<string[]> {
  const result = await db.execute(sql`
    WITH f AS (
      SELECT data, SUM(total_pagamento)::float8 AS total,
             SUM(numero_vendas)::int AS vendas, COUNT(*)::int AS linhas
        FROM fechamento_caixa_dia
       WHERE loja = ${loja} AND data BETWEEN ${inicio}::date AND ${fim}::date
       GROUP BY data
    ), i AS (
      SELECT data, SUM(total)::float8 AS total
        FROM venda_produto_dia
       WHERE loja = ${loja} AND data BETWEEN ${inicio}::date AND ${fim}::date
       GROUP BY data
    )
    SELECT f.data::text AS data, f.total AS fechamento, f.vendas, f.linhas, i.total AS itens
      FROM f JOIN i USING (data)
     ORDER BY f.data
  `);
  return result.rows
    .filter((row) => fechamentoIncompleto({
      totalFechamento: Number(row.fechamento ?? 0),
      totalItens: Number(row.itens ?? 0),
      vendas: Number(row.vendas ?? 0),
      linhas: Number(row.linhas ?? 0),
    }))
    .map((row) => String(row.data));
}
