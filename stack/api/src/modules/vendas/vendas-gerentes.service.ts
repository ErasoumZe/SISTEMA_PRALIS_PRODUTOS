import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { VendasGerentes, VendasRanking } from '@pralis/shared';
import { AppError } from '@/config/api.replies';
import { db } from '@/db/databases';

type Loja = 'TNP' | 'LI';
type Linha = { data: string; pdv: string; total: number };
const pontos = (valor: number) => Math.round(valor * VendasRanking.PONTOS_POR_REAL * 100) / 100;

function datasDoPeriodo(inicio: string, fim: string): string[] {
  const inicioMs = Date.parse(`${inicio}T00:00:00Z`);
  const fimMs = Date.parse(`${fim}T00:00:00Z`);
  if (!Number.isFinite(inicioMs) || !Number.isFinite(fimMs)
    || new Date(inicioMs).toISOString().slice(0, 10) !== inicio
    || new Date(fimMs).toISOString().slice(0, 10) !== fim
    || fimMs < inicioMs) throw new AppError('Período inválido.', 422, 'INVALID_PERIOD');
  if (fimMs - inicioMs > 34 * 86_400_000) throw new AppError('O período máximo é de 35 dias.', 422, 'PERIOD_TOO_LARGE');
  const datas: string[] = [];
  for (let ms = inicioMs; ms <= fimMs; ms += 86_400_000) datas.push(new Date(ms).toISOString().slice(0, 10));
  return datas;
}

export function montarRelatorioGerentes(
  loja: Loja, inicio: string, fim: string, pdvs: string[], linhas: Linha[], filtroPdv?: string,
): VendasGerentes.Gerentes {
  const datas = datasDoPeriodo(inicio, fim);
  if (filtroPdv && !pdvs.includes(filtroPdv)) throw new AppError('PDV não encontrado nesta loja.', 422, 'PDV_NOT_FOUND');
  const visiveis = filtroPdv ? [filtroPdv] : pdvs;
  const somas = new Map<string, number>();
  const porDia = new Map<string, number>();
  for (const linha of linhas) {
    if (!visiveis.includes(linha.pdv)) continue;
    const chave = `${linha.pdv}\u0000${linha.data}`;
    somas.set(linha.pdv, (somas.get(linha.pdv) ?? 0) + linha.total);
    porDia.set(chave, (porDia.get(chave) ?? 0) + linha.total);
  }
  const series = visiveis.map((pdv) => ({
    pdv,
    pontosTotal: pontos(somas.get(pdv) ?? 0),
    // Null significa "não chegou fechamento", não venda de zero pontos.
    dias: datas.map((data) => {
      const valor = porDia.get(`${pdv}\u0000${data}`);
      return { data, pontos: valor === undefined ? null : pontos(valor) };
    }),
  }));
  return {
    loja, periodo: { inicio, fim }, granularidade: 'dia', origem: 'fechamento_caixa_dia',
    pdvs, filtroPdv: filtroPdv ?? null,
    totalPontos: pontos([...somas.values()].reduce((soma, valor) => soma + valor, 0)),
    series,
  };
}

@injectable()
export class VendasGerentesService {
  async relatorio(loja: Loja, pedido: VendasGerentes.GerentesQuery): Promise<VendasGerentes.Gerentes> {
    datasDoPeriodo(pedido.inicio, pedido.fim);
    const [opcoes, movimento] = await Promise.all([
      db.execute(sql`SELECT DISTINCT pdv FROM fechamento_caixa_dia WHERE loja = ${loja} ORDER BY pdv`),
      db.execute(sql`
        SELECT data::text AS data, pdv, SUM(total_pagamento)::float8 AS total
        FROM fechamento_caixa_dia
        WHERE loja = ${loja} AND data BETWEEN ${pedido.inicio}::date AND ${pedido.fim}::date
        GROUP BY data, pdv ORDER BY data, pdv
      `),
    ]);
    return montarRelatorioGerentes(
      loja, pedido.inicio, pedido.fim,
      opcoes.rows.map((r) => String(r.pdv)),
      movimento.rows.map((r) => ({ data: String(r.data), pdv: String(r.pdv), total: Number(r.total) })),
      pedido.pdv,
    );
  }
}
