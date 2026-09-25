import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/databases';
import type { VendasSchemas } from '@pralis/shared';

type Loja = 'TNP' | 'LI';
type ProdutoRanking = VendasSchemas.ProdutoRanking;
const n = (value: unknown): number => Number(value ?? 0);

/**
 * DE ONDE saem os números da área de vendas num recorte.
 *
 * Duas fontes com grãos diferentes:
 *  - `itens` (`venda_item_pdv`): cada item de cupom, com hora, venda e PDV
 *    comprovados pelo ERP. Aceita hora, PDV, setor e grupo;
 *  - `diario` (`venda_produto_dia` + `fechamento_caixa_dia`): totais por dia.
 *    Só aceita data.
 *
 * Usa `itens` sempre que o período inteiro está coberto por eles — isto é,
 * começa no dia do primeiro item recebido ou depois. Começando antes, os dias
 * anteriores não teriam cupom e o total sairia menor sem aviso; então cai no
 * diário e a resposta DIZ que hora e PDV foram ignorados. Misturar as duas
 * fontes no mesmo período somaria grãos diferentes.
 */
export interface Fonte {
  tipo: 'itens' | 'diario';
  /** Primeiro dia com item de cupom desta loja; `null` se nenhum chegou. */
  desde: string | null;
  inicioTs: string;
  fimTs: string;
  dispositivo: string | null;
  /** Hora ou PDV pedidos que esta fonte NÃO pôde aplicar. */
  ignorados: Array<'hora' | 'pdv'>;
}

export interface PedidoFonte {
  hi?: string | null;
  hf?: string | null;
  pdv?: string | null;
}

const HORA = /^\d{2}:\d{2}$/;

/**
 * Pura: quem consulta `desde` é o repositório (`desdeItens`), para que teste
 * de unidade escolha a fonte sem tocar em banco nenhum.
 */
export function escolherFonte(inicio: string, fim: string, pedido: PedidoFonte, desde: string | null): Fonte {
  const hi = pedido.hi && HORA.test(pedido.hi) ? pedido.hi : null;
  const hf = pedido.hf && HORA.test(pedido.hf) ? pedido.hf : null;
  const dispositivo = pedido.pdv?.trim() || null;
  const usaItens = !!desde && inicio >= desde;
  const ignorados: Fonte['ignorados'] = [];
  if (!usaItens) {
    if (hi || hf) ignorados.push('hora');
    if (dispositivo) ignorados.push('pdv');
  }
  return {
    tipo: usaItens ? 'itens' : 'diario',
    desde,
    inicioTs: `${inicio} ${hi ?? '00:00'}`,
    fimTs: `${fim} ${hf ?? '23:59'}`,
    dispositivo: usaItens ? dispositivo : null,
    ignorados,
  };
}

/** O que vai para a resposta: o suficiente para a tela dizer a verdade. */
export const fonteParaResposta = (f: Fonte) => ({
  tipo: f.tipo,
  desde: f.desde,
  horaAplicada: f.tipo === 'itens',
  pdvAplicado: f.tipo === 'itens' && !!f.dispositivo,
  ignorados: f.ignorados,
});

/** Chave do produto vendido, a mesma do agrupamento: código + descrição. */
export const chaveProduto = (codigo: string, produto: string) => `${codigo}|${produto}`;

/* ------------------------- consultas sobre os itens ------------------------- */

/** Itens que CONTAM como vendidos no recorte: confirmados e não cancelados. */
function onde(loja: Loja, f: Fonte, chaves: string[] | null): SQL {
  const produtos = chaves === null
    ? sql``
    : chaves.length === 0
      ? sql`AND FALSE`
      : sql`AND (produto_codigo || '|' || produto) IN (${sql.join(chaves.map((c) => sql`${c}`), sql`, `)})`;
  return sql`loja = ${loja}
    AND vendido_em >= ${f.inicioTs}::timestamp AND vendido_em < (${f.fimTs}::timestamp + INTERVAL '1 minute')
    AND NOT item_cancelado AND venda_confirmada
    ${f.dispositivo ? sql`AND dispositivo_id_erp = ${f.dispositivo}` : sql``}
    ${produtos}`;
}

export async function produtosItens(loja: Loja, f: Fonte): Promise<ProdutoRanking[]> {
  const r = await db.execute(sql`
    SELECT produto_codigo, produto, SUM(quantidade) AS quantidade, SUM(total) AS faturamento
    FROM venda_item_pdv WHERE ${onde(loja, f, null)}
    GROUP BY produto_codigo, produto
    ORDER BY SUM(total) DESC, produto`);
  return r.rows.map((row) => ({
    produtoCodigo: String(row.produto_codigo ?? ''),
    produto: String(row.produto ?? ''),
    quantidade: n(row.quantidade),
    faturamento: n(row.faturamento),
  }));
}

export async function resumoItens(loja: Loja, f: Fonte, chaves: string[] | null) {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(total), 0) AS faturamento,
           COALESCE(SUM(quantidade), 0) AS quantidade,
           COUNT(DISTINCT venda_id_erp)::int AS numero_vendas,
           COUNT(DISTINCT (produto_codigo || '|' || produto)) FILTER (WHERE produto_codigo = '')::int AS sem_codigo,
           COALESCE(SUM(total) FILTER (WHERE produto_codigo = ''), 0) AS faturamento_sem_codigo
    FROM venda_item_pdv WHERE ${onde(loja, f, chaves)}`);
  const row = r.rows[0] ?? {};
  return {
    faturamento: n(row.faturamento),
    quantidade: n(row.quantidade),
    numeroVendas: n(row.numero_vendas),
    produtosSemCodigo: n(row.sem_codigo),
    faturamentoSemCodigo: n(row.faturamento_sem_codigo),
  };
}

/**
 * Série no tempo, por HORA ou por DIA. `vendido_em` já é hora local da loja:
 * `date_trunc` agrupa sem converter fuso.
 */
export async function serieItens(loja: Loja, f: Fonte, chaves: string[] | null, granularidade: 'hora' | 'dia') {
  const passo = granularidade === 'hora' ? sql`'hour'` : sql`'day'`;
  const formato = granularidade === 'hora' ? sql`'YYYY-MM-DD"T"HH24:00'` : sql`'YYYY-MM-DD'`;
  const r = await db.execute(sql`
    SELECT to_char(date_trunc(${passo}, vendido_em), ${formato}) AS t,
           COALESCE(SUM(total), 0) AS total,
           COUNT(DISTINCT venda_id_erp)::int AS numero_vendas
    FROM venda_item_pdv WHERE ${onde(loja, f, chaves)}
    GROUP BY 1 ORDER BY 1`);
  const pontos = r.rows.map((row) => ({ t: String(row.t), total: n(row.total), numeroVendas: n(row.numero_vendas) }));
  return preencherLacunas(pontos, granularidade);
}

/**
 * Hora (ou dia) sem venda entra como ZERO, do primeiro ao último ponto.
 *
 * Sem isso o eixo pulava de 09h para 17h e a linha suave desenhava uma ponte
 * entre os dois — uma tarde inteira de vendas que não aconteceram. Visto em
 * print em 25/09/2026.
 */
export function preencherLacunas(
  pontos: Array<{ t: string; total: number; numeroVendas: number }>,
  granularidade: 'hora' | 'dia',
) {
  if (pontos.length < 2) return pontos;
  const porT = new Map(pontos.map((p) => [p.t, p]));
  const passoMs = granularidade === 'hora' ? 3_600_000 : 86_400_000;
  // aritmética em UTC só para andar o relógio; os rótulos continuam hora local da loja
  const paraMs = (t: string) => Date.parse(granularidade === 'hora' ? `${t}:00Z` : `${t}T00:00:00Z`);
  const paraT = (ms: number) => {
    const iso = new Date(ms).toISOString();
    return granularidade === 'hora' ? `${iso.slice(0, 13)}:00` : iso.slice(0, 10);
  };
  const saida = [];
  for (let ms = paraMs(pontos[0]!.t); ms <= paraMs(pontos[pontos.length - 1]!.t); ms += passoMs) {
    const t = paraT(ms);
    saida.push(porT.get(t) ?? { t, total: 0, numeroVendas: 0 });
  }
  return saida;
}

export async function porPdvItens(loja: Loja, f: Fonte, chaves: string[] | null) {
  const r = await db.execute(sql`
    SELECT dispositivo_id_erp, MAX(pdv) AS pdv,
           COALESCE(SUM(total), 0) AS total,
           COUNT(DISTINCT venda_id_erp)::int AS numero_vendas
    FROM venda_item_pdv WHERE ${onde(loja, f, chaves)}
    GROUP BY dispositivo_id_erp`);
  return r.rows.map((row) => ({
    dispositivoIdErp: String(row.dispositivo_id_erp ?? ''),
    pdv: String(row.pdv ?? ''),
    total: n(row.total),
    numeroVendas: n(row.numero_vendas),
  }));
}
