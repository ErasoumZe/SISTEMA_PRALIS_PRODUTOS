import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import type { VendasLista } from '@pralis/shared';
import { VendasReportRepository } from './vendas-report.repository';
import { filtroVazio, indexarPorCodigo, passaNoFiltro, resolverProduto, type FiltroCadastro } from './vendas-margem';
import { validarPeriodoPdv } from './vendas-pdv.service';

type Loja = 'TNP' | 'LI';
const numero = (v: unknown) => Number(v ?? 0);
/** `timestamp` sem fuso volta como string `YYYY-MM-DD HH:mm:ss`; a tela usa `T`. */
const dataHora = (v: unknown) => String(v ?? '').replace(' ', 'T').slice(0, 19);

/**
 * A lista de vendas, cupom a cupom, sobre `venda_item_pdv`.
 *
 * Nenhuma inferência: a venda é o `venda_id_erp` que o ERP mandou, o PDV é o
 * `dispositivo_id_erp`, a hora é `vendido_em`. O que a tela chama de "tempo
 * real" é reler isto a cada poucos segundos — a latência é do robô.
 */
@injectable()
export class VendasListaService {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  async lista(loja: Loja, query: VendasLista.ListaVendasQuery, podeVerDinheiro: boolean): Promise<VendasLista.ListaVendas> {
    validarPeriodoPdv(query.inicio, query.fim);
    const inicio = query.inicio.replace('T', ' ');
    const fim = query.fim.replace('T', ' ');
    const dispositivo = query.dispositivoIdErp?.trim() || null;
    const filtro: FiltroCadastro = { setor: query.setor, grupo: query.grupo, produto: query.produto };
    const filtrando = !filtroVazio(filtro);

    const condicaoBase = sql`loja = ${loja}
      AND vendido_em >= ${inicio}::timestamp AND vendido_em < (${fim}::timestamp + INTERVAL '1 minute')
      ${dispositivo ? sql`AND dispositivo_id_erp = ${dispositivo}` : sql``}`;

    /*
     * Filtro de cadastro não cabe em SQL: setor e grupo vivem no produto com
     * que o item CASOU (`resolverProduto`), não na venda. Então lê-se o par
     * (venda, produto) do período, resolve-se em memória e a lista recebe o
     * conjunto de vendas em que ao menos um item confirmado passou.
     */
    let vendasPermitidas: string[] | null = null;
    if (filtrando) {
      const [pares, cadastro, dePara] = await Promise.all([
        db.execute(sql`SELECT DISTINCT venda_id_erp, produto_codigo, produto
          FROM venda_item_pdv WHERE ${condicaoBase} AND NOT item_cancelado`),
        this.repository.produtosDaLoja(loja),
        this.repository.deParaDaLoja(loja),
      ]);
      const indice = indexarPorCodigo(cadastro);
      const ids = new Set<string>();
      for (const row of pares.rows) {
        const codigo = String(row.produto_codigo ?? '');
        const nome = String(row.produto ?? '');
        if (passaNoFiltro(resolverProduto(codigo, nome, indice, dePara), { produtoCodigo: codigo, produto: nome }, filtro)) {
          ids.add(String(row.venda_id_erp));
        }
      }
      vendasPermitidas = [...ids];
    }
    /*
     * `IN (...)` com um parâmetro por ID, e não `= ANY($1::text[])`: o
     * template `sql` do Drizzle expande um array JS em vários parâmetros
     * (`$1, $2, ...`), o que dentro de `ANY(...)` vira SQL inválido.
     */
    const condicaoVendas = vendasPermitidas === null
      ? sql``
      : vendasPermitidas.length === 0
        ? sql`AND FALSE`
        : sql`AND venda_id_erp IN (${sql.join(vendasPermitidas.map((id) => sql`${id}`), sql`, `)})`;

    const offset = (query.pagina - 1) * query.limite;
    const [presenca, pdvs, resultado] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::int AS total, MAX(origem_atualizada_em) AS atualizado
        FROM venda_item_pdv WHERE loja = ${loja}`),
      // opções do filtro: só loja + período, sem o próprio filtro de PDV
      db.execute(sql`SELECT dispositivo_id_erp, MAX(pdv) AS pdv
        FROM venda_item_pdv
        WHERE loja = ${loja}
          AND vendido_em >= ${inicio}::timestamp AND vendido_em < (${fim}::timestamp + INTERVAL '1 minute')
        GROUP BY dispositivo_id_erp ORDER BY 2`),
      db.execute(sql`
        WITH vendas AS (
          SELECT venda_id_erp, dispositivo_id_erp, pdv, venda_status, venda_confirmada,
                 MIN(vendido_em) AS vendido_em,
                 COUNT(*) FILTER (WHERE NOT item_cancelado)::int AS itens,
                 COALESCE(SUM(quantidade) FILTER (WHERE NOT item_cancelado), 0) AS quantidade,
                 COALESCE(SUM(total) FILTER (WHERE NOT item_cancelado), 0) AS total
          FROM venda_item_pdv
          WHERE ${condicaoBase} ${condicaoVendas}
          GROUP BY venda_id_erp, dispositivo_id_erp, pdv, venda_status, venda_confirmada
        )
        SELECT *, COUNT(*) OVER()::int AS total_linhas
        FROM vendas
        ORDER BY vendido_em DESC, venda_id_erp DESC
        LIMIT ${query.limite} OFFSET ${offset}`),
    ]);

    const linhas = resultado.rows;
    return {
      loja,
      periodo: { inicio: query.inicio, fim: query.fim, fuso: 'America/Sao_Paulo', granularidade: 'minuto' },
      filtros: {
        dispositivoIdErp: dispositivo,
        setor: query.setor?.trim() || null,
        grupo: query.grupo?.trim() || null,
        produto: query.produto?.trim() || null,
        ativo: filtrando || !!dispositivo,
      },
      disponivel: numero(presenca.rows[0]?.total) > 0,
      total: numero(linhas[0]?.total_linhas),
      pagina: query.pagina,
      limite: query.limite,
      atualizadoEm: presenca.rows[0]?.atualizado ? dataHora(presenca.rows[0].atualizado) : null,
      pdvs: pdvs.rows.map((row) => ({
        dispositivoIdErp: String(row.dispositivo_id_erp ?? ''),
        pdv: String(row.pdv ?? ''),
      })),
      vendas: linhas.map((row) => ({
        vendaIdErp: String(row.venda_id_erp),
        vendidoEm: dataHora(row.vendido_em),
        dispositivoIdErp: String(row.dispositivo_id_erp ?? ''),
        pdv: String(row.pdv ?? ''),
        itens: numero(row.itens),
        quantidade: numero(row.quantidade),
        total: podeVerDinheiro ? numero(row.total) : null,
        status: String(row.venda_status ?? ''),
        confirmada: Boolean(row.venda_confirmada),
        cancelada: String(row.venda_status ?? '') === 'C',
      })),
    };
  }

  async detalhe(loja: Loja, vendaIdErp: string, podeVerDinheiro: boolean): Promise<VendasLista.VendaDetalhe> {
    const [itens, cadastro, dePara] = await Promise.all([
      db.execute(sql`SELECT item_id_erp, produto_id_erp, produto_codigo, produto, quantidade, valor_unitario, total,
          item_cancelado, venda_status, venda_confirmada, dispositivo_id_erp, pdv, vendido_em
        FROM venda_item_pdv WHERE loja = ${loja} AND venda_id_erp = ${vendaIdErp}
        ORDER BY vendido_em, item_id_erp`),
      this.repository.produtosDaLoja(loja),
      this.repository.deParaDaLoja(loja),
    ]);
    const primeira = itens.rows[0];
    if (!primeira) throw new AppError('Venda não encontrada nesta loja.', 404, 'NOT_FOUND');
    const indice = indexarPorCodigo(cadastro);

    const linhas = itens.rows.map((row) => {
      const codigo = String(row.produto_codigo ?? '');
      const nome = String(row.produto ?? '');
      return {
        itemIdErp: String(row.item_id_erp),
        produtoIdErp: String(row.produto_id_erp ?? ''),
        produtoCodigo: codigo,
        produto: nome,
        produtoCadastro: resolverProduto(codigo, nome, indice, dePara)?.nome ?? null,
        quantidade: numero(row.quantidade),
        valorUnitario: podeVerDinheiro ? numero(row.valor_unitario) : null,
        total: podeVerDinheiro ? numero(row.total) : null,
        cancelado: Boolean(row.item_cancelado),
      };
    });
    const total = itens.rows.filter((r) => !r.item_cancelado).reduce((s, r) => s + numero(r.total), 0);

    return {
      loja,
      vendaIdErp,
      vendidoEm: dataHora(primeira.vendido_em),
      dispositivoIdErp: String(primeira.dispositivo_id_erp ?? ''),
      pdv: String(primeira.pdv ?? ''),
      status: String(primeira.venda_status ?? ''),
      confirmada: Boolean(primeira.venda_confirmada),
      total: podeVerDinheiro ? Math.round(total * 100) / 100 : null,
      itens: linhas,
    };
  }
}
