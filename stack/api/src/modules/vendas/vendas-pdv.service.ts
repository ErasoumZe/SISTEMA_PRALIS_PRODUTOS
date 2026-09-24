import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import type { VendasPdv } from '@pralis/shared';
import { VendasReportRepository } from './vendas-report.repository';
import { indexarPorCodigo, resolverProduto } from './vendas-margem';

type Loja = 'TNP' | 'LI';
const numero = (v: unknown) => Number(v ?? 0);

/** O filtro fecha no fim do minuto escolhido: [início, fim + 1 minuto). */
export function validarPeriodoPdv(inicio: string, fim: string): void {
  // Somente para validar calendário e duração. Os valores persistidos são
  // horas locais da loja; não converter para UTC nem presumir offset fixo.
  const a = new Date(`${inicio}:00Z`);
  const b = new Date(`${fim}:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())
    || a.toISOString().slice(0, 16) !== inicio || b.toISOString().slice(0, 16) !== fim || a > b) {
    throw new AppError('Período de data e hora inválido.', 422, 'INVALID_PERIOD');
  }
  if (b.getTime() - a.getTime() > 366 * 86_400_000) {
    throw new AppError('O período máximo é de 366 dias.', 422, 'PERIOD_TOO_LARGE');
  }
}

@injectable()
export class VendasPdvService {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  async detalhe(loja: Loja, query: VendasPdv.DetalhePdvQuery, podeVerDinheiro: boolean): Promise<VendasPdv.DetalhePdv> {
    validarPeriodoPdv(query.inicio, query.fim);
    const inicio = query.inicio.replace('T', ' ');
    const fim = query.fim.replace('T', ' ');
    const base = {
      loja,
      dispositivoIdErp: query.dispositivoIdErp,
      periodo: { inicio: query.inicio, fim: query.fim, fuso: 'America/Sao_Paulo' as const },
    };
    const [presenca, totais, linhas, cadastro, dePara] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::int AS total FROM venda_item_pdv
        WHERE loja = ${loja} AND dispositivo_id_erp = ${query.dispositivoIdErp}
          AND vendido_em >= ${inicio}::timestamp AND vendido_em < (${fim}::timestamp + INTERVAL '1 minute')`),
      db.execute(sql`SELECT COALESCE(SUM(quantidade), 0) AS quantidade,
          COALESCE(SUM(total), 0) AS faturamento,
          COUNT(DISTINCT venda_id_erp)::int AS numero_vendas
        FROM venda_item_pdv
        WHERE loja = ${loja} AND dispositivo_id_erp = ${query.dispositivoIdErp}
          AND vendido_em >= ${inicio}::timestamp AND vendido_em < (${fim}::timestamp + INTERVAL '1 minute')
          AND NOT item_cancelado AND venda_confirmada`),
      db.execute(sql`SELECT produto_id_erp, produto_codigo, produto,
          SUM(quantidade) AS quantidade, SUM(total) AS faturamento
        FROM venda_item_pdv
        WHERE loja = ${loja} AND dispositivo_id_erp = ${query.dispositivoIdErp}
          AND vendido_em >= ${inicio}::timestamp AND vendido_em < (${fim}::timestamp + INTERVAL '1 minute')
          AND NOT item_cancelado AND venda_confirmada
        GROUP BY produto_id_erp, produto_codigo, produto`),
      this.repository.produtosDaLoja(loja),
      this.repository.deParaDaLoja(loja),
    ]);
    const indice = indexarPorCodigo(cadastro);
    const ordenados = linhas.rows.map((row) => {
      const codigo = String(row.produto_codigo ?? '');
      const nome = String(row.produto ?? '');
      const produtoCadastro = resolverProduto(codigo, nome, indice, dePara);
      return {
        produtoIdErp: String(row.produto_id_erp ?? ''),
        produtoCodigo: codigo,
        produto: nome,
        produtoCadastro: produtoCadastro?.nome ?? null,
        quantidade: numero(row.quantidade),
        faturamentoReal: numero(row.faturamento),
      };
    }).sort((a, b) => query.ordenar === 'faturamento'
      ? b.faturamentoReal - a.faturamentoReal || a.produto.localeCompare(b.produto, 'pt-BR')
      : b.quantidade - a.quantidade || a.produto.localeCompare(b.produto, 'pt-BR'));
    const faturamento = numero(totais.rows[0]?.faturamento);
    const classificado = ordenados.filter((i) => i.produtoCadastro).reduce((s, i) => s + i.faturamentoReal, 0);
    const periodoInteiro = query.inicio.endsWith('T00:00') && query.fim.endsWith('T23:59');
    let fechamento: VendasPdv.DetalhePdv['fechamento'] = null;
    if (periodoInteiro) {
      const result = await db.execute(sql`SELECT COUNT(*)::int AS linhas,
          COALESCE(SUM(total_pagamento), 0) AS total,
          COALESCE(SUM(numero_vendas), 0)::int AS numero_vendas
        FROM fechamento_caixa_dia
        WHERE loja = ${loja} AND dispositivo_id_erp = ${query.dispositivoIdErp}
          AND data BETWEEN ${query.inicio.slice(0, 10)}::date AND ${query.fim.slice(0, 10)}::date`);
      const row = result.rows[0];
      if (numero(row?.linhas) > 0) {
        const total = numero(row?.total);
        fechamento = {
          total: podeVerDinheiro ? total : null,
          numeroVendas: numero(row?.numero_vendas),
          diferenca: podeVerDinheiro ? Math.round((total - faturamento) * 100) / 100 : null,
        };
      }
    }
    return {
      ...base,
      disponivel: numero(presenca.rows[0]?.total) > 0,
      faturamentoItens: podeVerDinheiro ? faturamento : null,
      quantidade: numero(totais.rows[0]?.quantidade),
      numeroVendas: numero(totais.rows[0]?.numero_vendas),
      coberturaCadastroPercentual: faturamento > 0 ? Math.round((classificado / faturamento) * 10_000) / 100 : 0,
      itens: ordenados.map((item) => ({
        produtoIdErp: item.produtoIdErp,
        produtoCodigo: item.produtoCodigo,
        produto: item.produto,
        produtoCadastro: item.produtoCadastro,
        quantidade: item.quantidade,
        faturamento: podeVerDinheiro ? item.faturamentoReal : null,
      })),
      fechamento,
    };
  }
}
