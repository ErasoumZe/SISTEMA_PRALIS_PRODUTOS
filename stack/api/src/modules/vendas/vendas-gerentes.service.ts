import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { VendasGerentes, VendasGerentesPeriodo, VendasRanking } from '@pralis/shared';
import { AppError } from '@/config/api.replies';
import { db } from '@/db/databases';
import { FatorPontosService } from './fator-pontos.service';

type Loja = 'TNP' | 'LI';
/**
 * Uma linha de movimento de um PDV num dia.
 *
 * `aoVivo` marca o que veio das vendas em curso (`venda_item_pdv`) em vez do
 * fechamento de caixa. O dia de hoje só tem fechamento depois que o caixa
 * fecha — e esperar o fim do expediente para ver o dia era a reclamação.
 */
type Linha = {
  data: string; pdv: string; dispositivoIdErp: string; total: number; numeroVendas: number;
  aoVivo?: boolean;
};
type ItemLinha = { data: string; dispositivoIdErp: string; quantidade: number; vendas: number };
const pontosCom = (fator: number) => (valor: number) => Math.round(valor * fator * 100) / 100;
/** A régua antiga, usada quando ninguém passa outra (testes puros inclusive). */
const pontos = pontosCom(VendasRanking.PONTOS_POR_REAL);
const dinheiro = (valor: number) => Math.round(valor * 100) / 100;

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
  itens: ItemLinha[] = [], podeVerDinheiro = false,
  /** Pontos por real. O padrão é a régua que valia antes da tela de configuração. */
  fator: number = VendasRanking.PONTOS_POR_REAL,
): VendasGerentes.Gerentes {
  const pontos = pontosCom(fator);
  const datas = datasDoPeriodo(inicio, fim);
  if (filtroPdv && !pdvs.includes(filtroPdv)) throw new AppError('PDV não encontrado nesta loja.', 422, 'PDV_NOT_FOUND');
  const visiveis = filtroPdv ? [filtroPdv] : pdvs;
  const somas = new Map<string, number>();
  const porDia = new Map<string, { total: number; numeroVendas: number; ids: Map<string, number>; semId: boolean; aoVivo: boolean }>();
  const donos = new Map<string, Set<string>>();
  for (const linha of linhas) {
    if (linha.dispositivoIdErp) {
      const idDia = `${linha.data}\u0000${linha.dispositivoIdErp}`;
      const nomes = donos.get(idDia) ?? new Set<string>();
      nomes.add(linha.pdv);
      donos.set(idDia, nomes);
    }
    if (!visiveis.includes(linha.pdv)) continue;
    const chave = `${linha.pdv}\u0000${linha.data}`;
    somas.set(linha.pdv, (somas.get(linha.pdv) ?? 0) + linha.total);
    const dia = porDia.get(chave) ?? { total: 0, numeroVendas: 0, ids: new Map<string, number>(), semId: false, aoVivo: false };
    dia.total += linha.total;
    dia.numeroVendas += linha.numeroVendas;
    if (linha.aoVivo) dia.aoVivo = true;
    if (linha.dispositivoIdErp) dia.ids.set(linha.dispositivoIdErp, (dia.ids.get(linha.dispositivoIdErp) ?? 0) + linha.numeroVendas);
    else dia.semId = true;
    porDia.set(chave, dia);
  }
  const itensPorDispositivo = new Map(itens.map((item) => [`${item.data}\u0000${item.dispositivoIdErp}`, item]));
  const series = visiveis.map((pdv) => ({
    pdv,
    pontosTotal: pontos(somas.get(pdv) ?? 0),
    // Null significa "não chegou fechamento", não venda de zero pontos.
    dias: datas.map((data) => {
      const dia = porDia.get(`${pdv}\u0000${data}`);
      if (!dia) return { data, pontos: null, faturamento: null, numeroVendas: null, ticketMedio: null, quantidade: null, vendasComItens: null, parcial: false };
      // Detalhes sem chave de dispositivo, ou com chave ambigua entre PDVs,
      // nao autorizam atribuir quantidade ao caixa por nome ou horario.
      const pares = [...dia.ids].map(([id, vendas]) => ({
        id, vendas, item: itensPorDispositivo.get(`${data}\u0000${id}`),
      }));
      const quantidadeConfiavel = !dia.semId && pares.length > 0 && pares.every(({ id, vendas, item }) =>
        donos.get(`${data}\u0000${id}`)?.size === 1 && (item !== undefined || vendas === 0));
      const quantidade = quantidadeConfiavel ? pares.reduce((soma, { item }) => soma + (item?.quantidade ?? 0), 0) : null;
      const vendasComItens = quantidadeConfiavel ? pares.reduce((soma, { item }) => soma + (item?.vendas ?? 0), 0) : null;
      return {
        data, pontos: pontos(dia.total),
        faturamento: podeVerDinheiro ? dinheiro(dia.total) : null,
        numeroVendas: dia.numeroVendas,
        ticketMedio: podeVerDinheiro && dia.numeroVendas > 0 ? dinheiro(dia.total / dia.numeroVendas) : null,
        quantidade, vendasComItens,
        parcial: dia.aoVivo,
      };
    }),
  }));
  return {
    loja, periodo: { inicio, fim }, granularidade: 'dia', origem: 'fechamento_caixa_dia',
    pdvs, filtroPdv: filtroPdv ?? null,
    totalPontos: pontos([...somas.values()].reduce((soma, valor) => soma + valor, 0)),
    diaAoVivo: linhas.find((linha) => linha.aoVivo)?.data ?? null,
    series,
  };
}

@injectable()
export class VendasGerentesService {
  constructor(@inject(FatorPontosService) private fatores: FatorPontosService) {}

  async relatorioHoras(
    loja: Loja, pedido: VendasGerentes.GerentesHorasQuery, podeVerDinheiro = false,
  ): Promise<VendasGerentes.GerentesHoras> {
    const pontos = pontosCom(await this.fatores.fatorEm(loja, pedido.data));
    const movimento = await db.execute(sql`
      SELECT to_char(vendido_em, 'HH24') || 'h' AS hora, pdv,
        SUM(total)::float8 AS total, SUM(quantidade)::float8 AS quantidade,
        COUNT(DISTINCT venda_id_erp)::int AS numero_vendas
      FROM venda_item_pdv
      WHERE loja = ${loja} AND vendido_em >= ${pedido.data}::date
        AND vendido_em < (${pedido.data}::date + INTERVAL '1 day')
        AND EXTRACT(HOUR FROM vendido_em) BETWEEN 6 AND 22
        AND NOT item_cancelado AND venda_confirmada AND NULLIF(BTRIM(pdv), '') IS NOT NULL
      GROUP BY 1, pdv ORDER BY 1, pdv`);
    const linhas = movimento.rows.map((r) => ({
      hora: String(r.hora), pdv: String(r.pdv), total: Number(r.total),
      quantidade: Number(r.quantidade), numeroVendas: Number(r.numero_vendas),
    }));
    const pdvs = [...new Set(linhas.map((r) => r.pdv))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (pedido.pdv && !pdvs.includes(pedido.pdv)) throw new AppError('PDV sem itens neste dia.', 422, 'PDV_NOT_FOUND');
    const visiveis = pedido.pdv ? [pedido.pdv] : pdvs;
    const fora = await db.execute(sql`
      SELECT COALESCE(SUM(total), 0)::float8 AS total FROM venda_item_pdv
      WHERE loja = ${loja} AND vendido_em >= ${pedido.data}::date
        AND vendido_em < (${pedido.data}::date + INTERVAL '1 day')
        AND EXTRACT(HOUR FROM vendido_em) NOT BETWEEN 6 AND 22
        AND NOT item_cancelado AND venda_confirmada
        AND NULLIF(BTRIM(pdv), '') IS NOT NULL
        ${pedido.pdv ? sql`AND pdv = ${pedido.pdv}` : sql``}`);
    const horas = Array.from({ length: 17 }, (_, i) => `${String(i + 6).padStart(2, '0')}h`);
    const series = visiveis.map((pdv) => {
      const porPdv = linhas.filter((r) => r.pdv === pdv);
      return {
        pdv, pontosTotal: pontos(porPdv.reduce((soma, linha) => soma + linha.total, 0)),
        horas: porPdv.map((r) => ({
          hora: r.hora, pontos: pontos(r.total),
          faturamento: podeVerDinheiro ? dinheiro(r.total) : null,
          quantidade: r.quantidade, numeroVendas: r.numeroVendas,
          ticketMedio: podeVerDinheiro && r.numeroVendas > 0 ? dinheiro(r.total / r.numeroVendas) : null,
        })),
      };
    });
    return {
      loja, data: pedido.data, origem: 'venda_item_pdv', horas, pdvs, filtroPdv: pedido.pdv ?? null,
      totalPontos: pontos(linhas.filter((linha) => visiveis.includes(linha.pdv)).reduce((soma, linha) => soma + linha.total, 0)),
      pontosForaHorario: pontos(Number(fora.rows[0]?.total ?? 0)), series,
    };
  }

  async relatorio(loja: Loja, pedido: VendasGerentes.GerentesQuery, podeVerDinheiro = false): Promise<VendasGerentes.Gerentes> {
    datasDoPeriodo(pedido.inicio, pedido.fim);
    const movimento = await db.execute(sql`
        SELECT data::text AS data, pdv, dispositivo_id_erp,
          SUM(total_pagamento)::float8 AS total, SUM(numero_vendas)::int AS numero_vendas
        FROM fechamento_caixa_dia
        WHERE loja = ${loja} AND data BETWEEN ${pedido.inicio}::date AND ${pedido.fim}::date
          AND NULLIF(BTRIM(pdv), '') IS NOT NULL
        GROUP BY data, pdv, dispositivo_id_erp ORDER BY data, pdv, dispositivo_id_erp
      `);
    const linhas: Linha[] = movimento.rows.map((r) => ({
      data: String(r.data), pdv: String(r.pdv), dispositivoIdErp: String(r.dispositivo_id_erp ?? ''),
      total: Number(r.total), numeroVendas: Number(r.numero_vendas),
    }));
    /*
     * O DIA EM CURSO entra pelas vendas ao vivo.
     *
     * `fechamento_caixa_dia` só existe depois que o caixa fecha, então hoje
     * aparecia como buraco no gráfico até o fim do expediente. Quando o dia já
     * tem fechamento (caixa fechou e o robô trouxe), o fechamento manda: ele é
     * a fonte oficial e inclui lançamentos que a venda de produto não tem.
     */
    const hoje = VendasGerentesPeriodo.hojeSaoPaulo();
    const aoVivo: Linha[] = [];
    const itensAoVivo: ItemLinha[] = [];
    if (hoje >= pedido.inicio && hoje <= pedido.fim && !linhas.some((linha) => linha.data === hoje)) {
      const curso = await db.execute(sql`
        SELECT pdv, COALESCE(NULLIF(BTRIM(dispositivo_id_erp), ''), '') AS dispositivo_id_erp,
          SUM(total)::float8 AS total,
          SUM(quantidade)::float8 AS quantidade,
          COUNT(DISTINCT venda_id_erp)::int AS numero_vendas
        FROM venda_item_pdv
        WHERE loja = ${loja}
          AND vendido_em >= ${hoje}::date AND vendido_em < (${hoje}::date + INTERVAL '1 day')
          AND NOT item_cancelado AND venda_confirmada
          AND NULLIF(BTRIM(pdv), '') IS NOT NULL
        GROUP BY pdv, 2 ORDER BY pdv
      `);
      for (const r of curso.rows) {
        const dispositivoIdErp = String(r.dispositivo_id_erp ?? '');
        aoVivo.push({
          data: hoje, pdv: String(r.pdv), dispositivoIdErp,
          total: Number(r.total), numeroVendas: Number(r.numero_vendas), aoVivo: true,
        });
        if (dispositivoIdErp) {
          itensAoVivo.push({
            data: hoje, dispositivoIdErp,
            quantidade: Number(r.quantidade), vendas: Number(r.numero_vendas),
          });
        }
      }
      linhas.push(...aoVivo);
    }
    // Só oferecer PDVs com fechamento NESTE período. Um dispositivo cadastrado
    // historicamente, mas sem movimento agora, não é uma série de zero pontos.
    const pdvs = [...new Set(linhas.map((r) => r.pdv))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const detalhe = await db.execute(sql`
      WITH dispositivos AS (
        SELECT DISTINCT dispositivo_id_erp
        FROM fechamento_caixa_dia
        WHERE loja = ${loja} AND data BETWEEN ${pedido.inicio}::date AND ${pedido.fim}::date
          AND NULLIF(BTRIM(pdv), '') IS NOT NULL
          AND NULLIF(BTRIM(dispositivo_id_erp), '') IS NOT NULL
      )
      SELECT i.vendido_em::date::text AS data, i.dispositivo_id_erp,
        SUM(i.quantidade)::float8 AS quantidade,
        COUNT(DISTINCT i.venda_id_erp)::int AS vendas
      FROM venda_item_pdv i
      JOIN dispositivos d ON d.dispositivo_id_erp = i.dispositivo_id_erp
      WHERE i.loja = ${loja}
        AND i.vendido_em >= ${pedido.inicio}::date
        AND i.vendido_em < (${pedido.fim}::date + INTERVAL '1 day')
        AND NOT i.item_cancelado AND i.venda_confirmada
      GROUP BY i.vendido_em::date, i.dispositivo_id_erp
    `);
    const itens: ItemLinha[] = detalhe.rows.map((r) => ({
      data: String(r.data), dispositivoIdErp: String(r.dispositivo_id_erp),
      quantidade: Number(r.quantidade), vendas: Number(r.vendas),
    }));
    itens.push(...itensAoVivo);
    return montarRelatorioGerentes(
      loja, pedido.inicio, pedido.fim,
      pdvs, linhas,
      pedido.pdv, itens, podeVerDinheiro,
      // a régua do relatório é a vigente no primeiro dia do período
      await this.fatores.fatorEm(loja, pedido.inicio),
    );
  }
}
