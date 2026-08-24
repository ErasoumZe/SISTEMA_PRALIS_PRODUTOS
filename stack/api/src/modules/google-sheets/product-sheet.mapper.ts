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
 * Rótulos dos dias, na ordem das colunas BB..BH (= ordem do array `dias` do banco).
 *
 * A coluna AP (V. VENDA FINAL) decide se a promoção vale hoje com
 * `HLOOKUP(<rótulo do dia de hoje>, $BB$11:$BH$11, 1, 0)`, e o rótulo vem da
 * tabela de apoio `(TNPLIHORA - EXP.) DATASNUMEROS!AH11:AI17`
 * (1=DOM, 2=SEG, ... 7=SAB). Ou seja: a célula tem de conter o PRÓPRIO rótulo
 * do dia quando ativo e ficar VAZIA quando inativo — "SIM"/"NÃO" nunca casaria
 * no HLOOKUP e a promoção jamais seria aplicada.
 */
export const DIA_LABELS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'] as const;

/**
 * Desconto promocional para a coluna AZ, em fração NEGATIVA.
 *
 * A coluna AY calcula `(AZ*AO)+AO`, ou seja `AO*(1+AZ)`: 20% de desconto só
 * resulta em 0,8×AO se AZ for -0,20. A validação de dados da coluna (intervalo
 * nomeado PORCENTAGEMDESCONTO) aceita apenas 0 e valores negativos.
 * No banco o desconto é guardado como fração positiva, então normalizamos aqui.
 */
export const descontoParaAZ = (pct: number): number => (pct === 0 ? 0 : -Math.abs(pct));

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
  'Q', 'R', 'S', 'T', 'V', 'W', 'X', 'Y', 'Z',
  'AB', 'AC', 'AE', 'AG', 'AI', 'AJ', 'AL', 'AM', 'AN', 'AQ', 'AS',
  'AU', 'AW', 'AZ', 'BA', ...DIAS_COLS, 'BK', 'BL', 'BM', 'BO', 'BP',
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
    // Q e S são os flags que a planilha usa junto com R/T. São sempre
    // complementares: a coluna U só monta o texto "DENTRO DA EMB..." se S=SIM.
    Q: { kind: 'text', value: simNao(revenda) },
    R: revenda ? text(product.grupo) : EMPTY,
    S: { kind: 'text', value: simNao(!revenda) },
    T: revenda ? EMPTY : text(product.grupo),

    // ---- transformação ----
    V: tr ? text(tr.precisao) : EMPTY,
    W: tr ? number(tr.qtd) : EMPTY,
    X: tr ? text(tr.unidade) : EMPTY,
    Y: tr ? text(tr.produtoReceituario) : EMPTY,
    Z: tr ? text(tr.refReceituario) : EMPTY,

    // ---- cadastro / estoque / preço ----
    // AB espelha o status: a coluna AD (`IF(AB<>"";P;"")`) só mostra a descrição
    // quando AB está preenchida. Nas 150 linhas existentes AB == C sempre.
    AB: { kind: 'text', value: product.status === 'inativo' ? 'INATIVO' : 'ATIVO' },
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
    AU: { kind: 'text', value: simNao(!!promo) },
    AW: promo && promo.tipo === 'valor' ? number(promo.valor) : EMPTY,
    AZ:
      promo && promo.tipo === 'desconto' && promo.descontoPct != null
        ? { kind: 'number', value: descontoParaAZ(promo.descontoPct) } // fração NEGATIVA
        : EMPTY,
    // BA aceita só os rótulos da lista DESCONTOATE ("ATÉ 5%" … "ATÉ 50%") — é
    // texto, apesar do formato de percentual da coluna. Nenhuma fórmula a usa.
    BA: promo ? text(promo.descontoAte) : EMPTY,
    BK: { kind: 'text', value: 'DE:' },   // rótulo fixo antes da hora inicial
    BL: promo ? entered(promo.horaInicio) : EMPTY,
    BM: { kind: 'text', value: 'ATÉ:' },  // rótulo fixo antes da hora final
    BO: promo ? entered(promo.horaFim) : EMPTY,
    BP: { kind: 'text', value: 'NÃO REVISADO' },

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

  // dias da promoção: o RÓTULO do dia quando ativo, célula vazia quando inativo
  // (é o que o HLOOKUP da coluna AP procura — ver DIA_LABELS).
  DIAS_COLS.forEach((col, i) => {
    const ativo = !!promo && (promo.dias?.[i] ?? false);
    cells[col] = ativo ? { kind: 'text', value: DIA_LABELS[i]! } : EMPTY;
  });

  return cells;
}
