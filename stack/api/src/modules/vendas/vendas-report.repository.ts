import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import type { VendasSchemas } from '@pralis/shared';
import { chaveDePara, type ProdutoCadastro } from './vendas-margem';

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

  /**
   * Cadastro da loja, só com o que a margem precisa. Consulta enxuta de
   * proposito: `ProductRepository.list()` carrega promoções, fiscal e
   * transformação por produto, o que aqui seria N+1 sem serventia.
   */
  async produtosDaLoja(loja: Loja): Promise<ProdutoCadastro[]> {
    const result = await db.execute(sql`
      SELECT id, nome, codigo_barras, custo, qt_cad, quantidade, medida_base,
             grupo, setor_estoque, setor_venda_1, estoque_min, estoque_max
        FROM products WHERE loja = ${loja}
    `);
    return result.rows.map((row) => ({
      id: String(row.id),
      nome: String(row.nome ?? ''),
      codigoBarras: row.codigo_barras == null ? null : String(row.codigo_barras),
      custo: row.custo == null ? null : Number(row.custo),
      qtCad: Number(row.qt_cad ?? 1),
      quantidade: row.quantidade == null ? null : Number(row.quantidade),
      medidaBase: row.medida_base == null ? null : String(row.medida_base),
      grupo: row.grupo == null ? null : String(row.grupo),
      setorEstoque: row.setor_estoque == null ? null : String(row.setor_estoque),
      setorVenda1: row.setor_venda_1 == null ? null : String(row.setor_venda_1),
      estoqueMin: row.estoque_min == null ? null : Number(row.estoque_min),
      estoqueMax: row.estoque_max == null ? null : Number(row.estoque_max),
    }));
  }

  /**
   * Faturamento por PDV, direto do fechamento de caixa.
   *
   * Vem daqui e não das vendas por produto porque a venda por produto é
   * agregada por DIA, sem PDV — não existe no dado quem passou o quê em qual
   * caixa. O fechamento, sim, é por (loja, data, pdv, operador).
   *
   * Consequência que a tela precisa dizer: dá para ranquear o DINHEIRO por
   * caixa, nunca os produtos de um caixa.
   */
  async porPdv(loja: Loja, inicio: string, fim: string): Promise<Array<{
    pdv: string; operador: string; total: number; numeroVendas: number;
  }>> {
    const result = await db.execute(sql`
      SELECT pdv,
             min(operador) AS operador,
             sum(total_pagamento)::float8 AS total,
             sum(numero_vendas)::int AS numero_vendas
        FROM fechamento_caixa_dia
       WHERE loja = ${loja} AND data BETWEEN ${inicio} AND ${fim}
       GROUP BY pdv
    `);
    return result.rows.map((row) => ({
      pdv: String(row.pdv ?? ''),
      operador: String(row.operador ?? ''),
      total: Number(row.total ?? 0),
      numeroVendas: Number(row.numero_vendas ?? 0),
    }));
  }

  /**
   * A última venda e o último recebimento de cada fonte.
   *
   * `UNION ALL` das duas tabelas porque a pergunta é a mesma e a resposta
   * precisa vir junta: venda por produto e fechamento de caixa chegam em lotes
   * diferentes, e uma pode parar sem a outra. Consultá-las separadamente
   * deixaria a tela decidir o que comparar.
   */
  async pulsoDasFontes(): Promise<Array<{
    loja: string; tipo: string; ultimoDia: string | null; ultimaChegada: string | null;
  }>> {
    const result = await db.execute(sql`
      SELECT 'venda_produto_dia' AS tipo, loja,
             max(data)::text AS ultimo_dia,
             max(atualizado_em)::text AS ultima_chegada
        FROM venda_produto_dia GROUP BY loja
      UNION ALL
      SELECT 'fechamento_caixa_dia' AS tipo, loja,
             max(data)::text AS ultimo_dia,
             max(atualizado_em)::text AS ultima_chegada
        FROM fechamento_caixa_dia GROUP BY loja
      ORDER BY loja, tipo
    `);
    return result.rows.map((row) => ({
      loja: String(row.loja ?? ''),
      tipo: String(row.tipo ?? ''),
      ultimoDia: row.ultimo_dia == null ? null : String(row.ultimo_dia),
      ultimaChegada: row.ultima_chegada == null ? null : String(row.ultima_chegada),
    }));
  }

  /** Vínculos confirmados por pessoa: código do PDV -> produto do cadastro. */
  async deParaDaLoja(loja: Loja): Promise<Map<string, ProdutoCadastro>> {
    /*
     * Os campos de CLASSIFICAÇÃO entram aqui também, e não só em
     * `produtosDaLoja`.
     *
     * Sem eles, o produto que chegou pelo de-para confirmado à mão voltava sem
     * grupo e sem setor — e o ranking o jogava em "sem classificação" justo
     * quando alguém já tinha feito o trabalho de dizer qual produto era. Um
     * teste de integração pegou isso; a olho não aparecia, porque o caminho
     * automático (por código) funcionava.
     */
    const result = await db.execute(sql`
      SELECT pc.produto_codigo, pc.produto, p.id, p.nome, p.codigo_barras, p.custo, p.qt_cad,
             p.grupo, p.setor_estoque, p.setor_venda_1, p.estoque_min, p.estoque_max
        FROM produto_creare pc
        JOIN products p ON p.id = pc.product_id
       WHERE pc.loja = ${loja}
    `);
    const mapa = new Map<string, ProdutoCadastro>();
    for (const row of result.rows) {
      mapa.set(chaveDePara(String(row.produto_codigo ?? ''), String(row.produto ?? '')), {
        id: String(row.id),
        nome: String(row.nome ?? ''),
        codigoBarras: row.codigo_barras == null ? null : String(row.codigo_barras),
        custo: row.custo == null ? null : Number(row.custo),
        qtCad: Number(row.qt_cad ?? 1),
        grupo: row.grupo == null ? null : String(row.grupo),
        setorEstoque: row.setor_estoque == null ? null : String(row.setor_estoque),
        setorVenda1: row.setor_venda_1 == null ? null : String(row.setor_venda_1),
        estoqueMin: row.estoque_min == null ? null : Number(row.estoque_min),
        estoqueMax: row.estoque_max == null ? null : Number(row.estoque_max),
      });
    }
    return mapa;
  }
}
