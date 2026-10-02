import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import { VendasGerentes, VendasRanking } from '@pralis/shared';
import { VendasReportRepository } from './vendas-report.repository';
import { indexarPorCodigo, resolverProduto } from './vendas-margem';

const arredondar = (n: number) => Math.round(n * 100) / 100;
const pontos = (n: number) => arredondar(n * VendasRanking.PONTOS_POR_REAL);

function categorias(inicio: string, fim: string, granularidade: 'hora' | 'dia'): string[] {
  const primeiro = Date.parse(`${inicio}T00:00:00Z`);
  const ultimo = Date.parse(`${fim}T00:00:00Z`);
  if (!Number.isFinite(primeiro) || !Number.isFinite(ultimo)
    || new Date(primeiro).toISOString().slice(0, 10) !== inicio
    || new Date(ultimo).toISOString().slice(0, 10) !== fim || ultimo < primeiro
    || ultimo - primeiro > 34 * 86_400_000) {
    throw new AppError('Período inválido ou superior a 35 dias.', 422, 'INVALID_PERIOD');
  }
  if (granularidade === 'hora') {
    if (inicio !== fim) throw new AppError('Selecione um único dia para visualizar por hora.', 422, 'INVALID_PERIOD');
    return Array.from({ length: 17 }, (_, i) => `${String(i + 6).padStart(2, '0')}h`);
  }
  const saida: string[] = [];
  for (let ms = primeiro; ms <= ultimo; ms += 86_400_000) saida.push(new Date(ms).toISOString().slice(0, 10));
  return saida;
}

@injectable()
export class VendasGerentesAreasService {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  async relatorio(pedido: VendasGerentes.GerentesAreasQuery, podeVerDinheiro: boolean): Promise<VendasGerentes.GerentesAreas> {
    const { inicio, fim, granularidade } = pedido;
    const eixo = categorias(inicio, fim, granularidade);
    if (granularidade === 'dia') return this.relatorioDiario(inicio, fim, eixo, podeVerDinheiro);
    const horario = granularidade === 'hora' ? sql`AND EXTRACT(HOUR FROM i.vendido_em) BETWEEN 6 AND 22` : sql``;
    const onde = sql`i.loja = 'TNP' AND i.vendido_em >= ${inicio}::date
      AND i.vendido_em < (${fim}::date + INTERVAL '1 day')
      AND NOT i.item_cancelado AND i.venda_confirmada`;

    // Resolve uma vez por SKU, pela mesma regra de código/de-para do ranking.
    // Sem produto casado ou sem área preenchida, a venda fica na cobertura,
    // nunca é adivinhada a partir do PDV, nome ou local de estoque.
    const [sku, cadastro, dePara, totais] = await Promise.all([
      db.execute(sql`SELECT DISTINCT i.produto_codigo, i.produto FROM venda_item_pdv i WHERE ${onde} ${horario}`),
      this.repository.produtosDaLoja('TNP'),
      this.repository.deParaDaLoja('TNP'),
      db.execute(sql`SELECT COALESCE(SUM(i.total), 0)::float8 AS total,
        COALESCE(SUM(i.total) FILTER (WHERE EXTRACT(HOUR FROM i.vendido_em) NOT BETWEEN 6 AND 22), 0)::float8 AS fora_horario
        FROM venda_item_pdv i WHERE ${onde}`),
    ]);
    const indice = indexarPorCodigo(cadastro);
    const mapa: Array<{ codigo: string; nome: string; area: VendasGerentes.AreaTnp }> = [];
    let produtosSemVinculo = 0;
    let produtosSemArea = 0;
    for (const row of sku.rows) {
      const codigo = String(row.produto_codigo ?? '');
      const nome = String(row.produto ?? '');
      const produto = resolverProduto(codigo, nome, indice, dePara);
      if (!produto) { produtosSemVinculo++; continue; }
      const area = VendasGerentes.areaTnpSchema.safeParse(produto.areaVenda);
      if (!area.success) { produtosSemArea++; continue; }
      mapa.push({ codigo, nome, area: area.data });
    }

    const totalItens = Number(totais.rows[0]?.total ?? 0);
    const foraHorario = granularidade === 'hora' ? Number(totais.rows[0]?.fora_horario ?? 0) : 0;
    const totalNaJanela = totalItens - foraHorario;
    if (!mapa.length) return {
      loja: 'TNP', periodo: { inicio, fim }, granularidade, origem: 'venda_item_pdv', categorias: eixo,
      totalPontos: pontos(totalNaJanela), pontosSemArea: pontos(totalNaJanela), pontosForaHorario: pontos(foraHorario),
      produtosSemVinculo, produtosSemArea, series: [],
    };

    const valores = sql.join(mapa.map(({ codigo, nome, area }) => sql`(${codigo}, ${nome}, ${area})`), sql`, `);
    const chave = granularidade === 'hora'
      ? sql`(to_char(i.vendido_em, 'HH24') || 'h')`
      : sql`i.vendido_em::date::text`;
    const r = await db.execute(sql`
      WITH mapa(produto_codigo, produto, area) AS (VALUES ${valores})
      SELECT ${chave} AS chave, mapa.area,
        SUM(i.total)::float8 AS total, SUM(i.quantidade)::float8 AS quantidade,
        COUNT(DISTINCT i.venda_id_erp)::int AS numero_vendas
      FROM venda_item_pdv i
      JOIN mapa ON mapa.produto_codigo = i.produto_codigo AND mapa.produto = i.produto
      WHERE ${onde} ${horario}
      GROUP BY 1, mapa.area ORDER BY 1, mapa.area`);
    const porArea = new Map<VendasGerentes.AreaTnp, Array<{
      chave: string; pontos: number; faturamento: number | null;
      quantidade: number; numeroVendas: number; ticketMedio: number | null;
    }>>();
    let classificado = 0;
    for (const row of r.rows) {
      const area = row.area as VendasGerentes.AreaTnp;
      const total = Number(row.total ?? 0);
      const vendas = Number(row.numero_vendas ?? 0);
      classificado += total;
      const pontosArea = porArea.get(area) ?? [];
      pontosArea.push({
        chave: String(row.chave), pontos: pontos(total),
        faturamento: podeVerDinheiro ? arredondar(total) : null,
        quantidade: Number(row.quantidade ?? 0), numeroVendas: vendas,
        ticketMedio: podeVerDinheiro && vendas > 0 ? arredondar(total / vendas) : null,
      });
      porArea.set(area, pontosArea);
    }
    return {
      loja: 'TNP', periodo: { inicio, fim }, granularidade, origem: 'venda_item_pdv', categorias: eixo,
      totalPontos: pontos(totalNaJanela), pontosSemArea: pontos(Math.max(0, totalNaJanela - classificado)),
      pontosForaHorario: pontos(foraHorario), produtosSemVinculo, produtosSemArea,
      series: VendasGerentes.AREAS_TNP.filter((area) => porArea.has(area)).map((area) => ({
        area, pontosTotal: arredondar((porArea.get(area) ?? []).reduce((soma, ponto) => soma + ponto.pontos, 0)),
        pontos: porArea.get(area) ?? [],
      })),
    };
  }

  /** A fonte diária já chega do robô atual; ela não traz hora nem número de cupons por produto. */
  private async relatorioDiario(
    inicio: string, fim: string, eixo: string[], podeVerDinheiro: boolean,
  ): Promise<VendasGerentes.GerentesAreas> {
    const [vendas, cadastro, dePara] = await Promise.all([
      db.execute(sql`SELECT data::text AS chave, produto_codigo, produto,
        SUM(total)::float8 AS total, SUM(quantidade)::float8 AS quantidade
        FROM venda_produto_dia WHERE loja = 'TNP' AND data BETWEEN ${inicio}::date AND ${fim}::date
        GROUP BY data, produto_codigo, produto`),
      this.repository.produtosDaLoja('TNP'),
      this.repository.deParaDaLoja('TNP'),
    ]);
    const indice = indexarPorCodigo(cadastro);
    const porArea = new Map<VendasGerentes.AreaTnp, Map<string, { total: number; quantidade: number }>>();
    const semVinculo = new Set<string>();
    const semArea = new Set<string>();
    let total = 0;
    let classificado = 0;
    for (const row of vendas.rows) {
      const codigo = String(row.produto_codigo ?? '');
      const nome = String(row.produto ?? '');
      const valor = Number(row.total ?? 0);
      total += valor;
      const produto = resolverProduto(codigo, nome, indice, dePara);
      if (!produto) { semVinculo.add(`${codigo}|${nome}`); continue; }
      const area = VendasGerentes.areaTnpSchema.safeParse(produto.areaVenda);
      if (!area.success) { semArea.add(produto.id); continue; }
      classificado += valor;
      const porDia = porArea.get(area.data) ?? new Map<string, { total: number; quantidade: number }>();
      const chave = String(row.chave);
      const atual = porDia.get(chave) ?? { total: 0, quantidade: 0 };
      atual.total += valor;
      atual.quantidade += Number(row.quantidade ?? 0);
      porDia.set(chave, atual);
      porArea.set(area.data, porDia);
    }
    return {
      loja: 'TNP', periodo: { inicio, fim }, granularidade: 'dia', origem: 'venda_produto_dia', categorias: eixo,
      totalPontos: pontos(total), pontosSemArea: pontos(Math.max(0, total - classificado)),
      pontosForaHorario: 0, produtosSemVinculo: semVinculo.size, produtosSemArea: semArea.size,
      series: VendasGerentes.AREAS_TNP.filter((area) => porArea.has(area)).map((area) => {
        const pontosArea = [...porArea.get(area)!].sort(([a], [b]) => a.localeCompare(b)).map(([chave, valor]) => ({
          chave, pontos: pontos(valor.total), faturamento: podeVerDinheiro ? arredondar(valor.total) : null,
          quantidade: valor.quantidade, numeroVendas: null, ticketMedio: null,
        }));
        return { area, pontosTotal: pontos([...porArea.get(area)!.values()].reduce((soma, valor) => soma + valor.total, 0)), pontos: pontosArea };
      }),
    };
  }
}
