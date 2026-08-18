import type { ProductSchemas } from '@pralis/shared';

/**
 * Mapeamento INVERSO do importador (`src/db/gen-base-json.ts`): produto do
 * Postgres -> células da aba "(BASE) CADASTRO PRODUTOS".
 *
 * Só as colunas de ENTRADA aparecem aqui. As calculadas (H, P, U, AD, AF, AH,
 * AK, AO, AP, AR, AT, AV, AX, AY, BI, BJ, BR) nunca são escritas — elas vêm das
 * fórmulas copiadas da linha-modelo.
 *
 * Formatos confirmados na planilha (linha 5 = cabeçalhos, dados a partir da 11):
 *  - F  QUANTIDADE  -> coluna TEXTO, no padrão pt-BR com 3 casas ("25,000")
 *  - AL MARGEM PONT -> formato 0%     -> fração (0,7 = 70%) — igual ao banco
 *  - AZ PROMO DESC  -> formato 0.00%  -> fração             — igual ao banco
 *  - BL/BO HORAS    -> formato HH:mm:ss
 *  - J  CODIGO BARRAS -> hoje numérico; vira TEXTO quando tem zero à esquerda
 *  - AC/BV/CA/CE    -> TEXTO (preservam zeros à esquerda)
 */

type Product = ProductSchemas.ProductEntity;

/**
 * `text`    -> gravado com RAW: fica literal (preserva zero à esquerda e evita
 *              que um nome iniciado por "=" vire fórmula).
 * `number`  -> gravado com USER_ENTERED como número.
 * `entered` -> gravado com USER_ENTERED como string: a planilha interpreta
 *              (hora "12:00", percentual "20%").
 * `empty`   -> limpa a célula.
 */
export type SheetCell =
  | { kind: 'empty' }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'entered'; value: string };

export type CellMap = Record<string, SheetCell>;

export interface MapperOptions {
  /** Conteúdo da coluna D (LOJAS) — vem de GOOGLE_SHEETS_DEFAULT_LOJAS. */
  defaultLojas: string;
}

// ---- helpers ----
const EMPTY: SheetCell = { kind: 'empty' };

const text = (v: string | null | undefined): SheetCell => {
  const s = (v ?? '').trim();
  return s === '' ? EMPTY : { kind: 'text', value: s };
};

const number = (v: number | null | undefined): SheetCell =>
  v == null || Number.isNaN(v) ? EMPTY : { kind: 'number', value: v };

const entered = (v: string | null | undefined): SheetCell => {
  const s = (v ?? '').trim();
  return s === '' ? EMPTY : { kind: 'entered', value: s };
};

/** SIM/NÃO — a convenção da planilha para booleanos. */
export const simNao = (v: boolean): string => (v ? 'SIM' : 'NÃO');

/**
 * Quantidade no padrão da coluna F (texto pt-BR, 3 casas): 25 -> "25,000".
 * Sem separador de milhar — o importador remove pontos, então "1234,500" volta
 * a ser lido como 1234,5 sem ambiguidade.
 */
export const formatQuantidade = (n: number): string => n.toFixed(3).replace('.', ',');

/**
 * Código de barras: mantém número quando a planilha já guarda número (é o caso
 * hoje), mas vira TEXTO se tiver zero à esquerda ou não for só dígitos — assim
 * nenhum dígito se perde.
 */
export const barcodeCell = (codigo: string | null | undefined): SheetCell => {
  const s = (codigo ?? '').trim();
  if (s === '') return EMPTY;
  const soDigitos = /^[0-9]+$/.test(s);
  if (!soDigitos) return { kind: 'text', value: s };
  if (s.length > 1 && s.startsWith('0')) return { kind: 'text', value: s }; // preserva zero à esquerda
  if (!Number.isSafeInteger(Number(s))) return { kind: 'text', value: s }; // longo demais para número exato
  return { kind: 'number', value: Number(s) };
};

/** Colunas dos dias da promoção, na ordem SEG..DOM. */
export const DIAS_COLS = ['BB', 'BC', 'BD', 'BE', 'BF', 'BG', 'BH'] as const;

/** Todas as colunas de entrada controladas por este mapper. */
export const INPUT_COLUMNS: readonly string[] = [
  'C', 'D', 'E', 'F', 'G', 'J', 'K', 'L', 'M', 'N', 'O',
  'R', 'T', 'V', 'W', 'X', 'Y', 'Z',
  'AC', 'AE', 'AG', 'AI', 'AJ', 'AL', 'AM', 'AN', 'AQ', 'AS',
  'AW', 'AZ', 'BA', ...DIAS_COLS, 'BL', 'BO',
  'BS', 'BT', 'BU', 'BV', 'BW', 'BX', 'CA', 'CB', 'CD', 'CE',
  'CN', 'CO', 'CP',
];

/**
 * Monta o mapa coluna -> célula para um produto da BASE.
 * Toda coluna de entrada aparece no resultado; ausência de valor vira `empty`
 * (célula limpa), nunca sobra do que estava na linha antes.
 */
export function mapProductToCells(product: Product, opts: MapperOptions): CellMap {
  const revenda = product.tipo === 'revenda';
  const tr = product.transformacao;
  const fiscal = product.fiscal;
  // A planilha tem UM bloco de promoção por linha; usamos a primeira do produto.
  const promo = product.promocoes?.[0] ?? null;

  const cells: CellMap = {
    // ---- cadastro geral ----
    C: { kind: 'text', value: product.status === 'inativo' ? 'INATIVO' : 'ATIVO' },
    D: text(opts.defaultLojas),
    E: text(product.nome),
    F: { kind: 'text', value: formatQuantidade(product.quantidade ?? 0) },
    G: text(product.medidaBase),
    J: barcodeCell(product.codigoBarras),
    K: text(product.marca),
    L: text(product.embalagem),
    M: text(product.cDe),
    N: number(product.qtCad),
    O: text(product.medidaCompra),

    // ---- grupo: revenda (R) x transformação (T) — exclusivos ----
    R: revenda ? text(product.grupo) : EMPTY,
    T: revenda ? EMPTY : text(product.grupo),

    // ---- transformação ----
    V: tr ? text(tr.precisao) : EMPTY,
    W: tr ? number(tr.qtd) : EMPTY,
    X: tr ? text(tr.unidade) : EMPTY,
    Y: tr ? text(tr.produtoReceituario) : EMPTY,
    Z: tr ? text(tr.refReceituario) : EMPTY,

    // ---- cadastro / estoque / preço ----
    AC: text(product.codigoInterno), // TEXTO: preserva "00001"
    AE: number(product.estoqueMin),
    AG: number(product.estoqueMax),
    AI: text(product.setorEstoque),
    AJ: number(product.custo),
    AL: number(product.margemPontual), // fração, igual ao formato 0% da coluna
    AM: number(product.vVendaPontual),
    AN: { kind: 'text', value: simNao(product.auto) },
    AQ: text(product.localVenda1),
    AS: text(product.localVenda2),

    // ---- promoção ----
    AW: promo && promo.tipo === 'valor' ? number(promo.valor) : EMPTY,
    AZ: promo && promo.tipo === 'desconto' ? number(promo.descontoPct) : EMPTY,
    BA: promo ? entered(promo.descontoAte) : EMPTY,
    BL: promo ? entered(promo.horaInicio) : EMPTY,
    BO: promo ? entered(promo.horaFim) : EMPTY,

    // ---- fiscal ----
    BS: number(fiscal?.reducaoIcms ?? null),
    BT: number(fiscal?.aliquotaCheia ?? null),
    BU: number(fiscal?.aliquotaFcp ?? null),
    BV: text(fiscal?.cstPisCofins ?? null), // TEXTO: "01" não pode virar 1
    BW: number(fiscal?.aliquotaPis ?? null),
    BX: number(fiscal?.aliquotaCofins ?? null),
    CA: text(fiscal?.ncm ?? null), // TEXTO: NCM com zero à esquerda
    CB: text(fiscal?.categoria ?? null),
    CD: number(fiscal?.icms ?? null),
    CE: text(fiscal?.cest ?? null), // TEXTO: CEST com zero à esquerda

    // ---- rodapé ----
    CN: { kind: 'text', value: simNao(product.habilitarAjuda) },
    CO: text(product.fotoUrl),
    CP: { kind: 'text', value: product.id }, // chave de idempotência
  };

  // dias da promoção: SIM/NÃO quando existe promoção; célula vazia quando não existe
  DIAS_COLS.forEach((col, i) => {
    cells[col] = promo ? { kind: 'text', value: simNao(promo.dias?.[i] ?? false) } : EMPTY;
  });

  return cells;
}
