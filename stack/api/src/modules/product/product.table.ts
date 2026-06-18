import { pgTable, text, boolean, integer, numeric, timestamp, unique } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Schema do produto (modelo de ../docs/05-backend-esboco.md).
 * - products: identidade compartilhada entre lojas
 * - product_lojas: dados comerciais POR LOJA (estoque, custo, preço, locais)
 * - product_transformacao / product_fiscal: blocos 1:1 opcionais
 * - promocoes: 0..N por produto-loja
 */

export const products = pgTable('products', {
  id: text('id').primaryKey().$defaultFn(() => uuidv7()),
  codigo: text('codigo').unique().notNull(),
  nome: text('nome').notNull(),
  quantidade: numeric('quantidade', { precision: 12, scale: 3 }).notNull().default('0'),
  medidaBase: text('medida_base').notNull(),
  codigoBarras: text('codigo_barras'),
  marca: text('marca'),
  embalagem: text('embalagem'),
  cDe: text('c_de'),
  qtCad: integer('qt_cad').notNull().default(1),
  medidaCompra: text('medida_compra'),
  codigoInterno: text('codigo_interno'),
  fotoUrl: text('foto_url'),
  grupo: text('grupo'),
  tipo: text('tipo').notNull(), // 'revenda' | 'transformacao'
  status: text('status').notNull().default('ativo'),
  habilitarAjuda: boolean('habilitar_ajuda').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const productLojas = pgTable(
  'product_lojas',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    loja: text('loja').notNull(), // 'TNP' | 'LI' | 'HORA'
    estoqueMin: numeric('estoque_min', { precision: 12, scale: 3 }),
    estoqueMax: numeric('estoque_max', { precision: 12, scale: 3 }),
    setorEstoque: text('setor_estoque'),
    custo: numeric('custo', { precision: 12, scale: 2 }),
    margemPontual: numeric('margem_pontual', { precision: 6, scale: 4 }), // fração
    vVendaPontual: numeric('v_venda_pontual', { precision: 12, scale: 2 }),
    auto: boolean('auto').notNull().default(false),
    localVenda1: text('local_venda_1'),
    localVenda2: text('local_venda_2'),
  },
  (t) => [unique('uniq_produto_loja').on(t.productId, t.loja)],
);

export const productTransformacao = pgTable('product_transformacao', {
  productId: text('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  precisao: text('precisao'),
  qtd: numeric('qtd', { precision: 12, scale: 3 }),
  unidade: text('unidade'),
  produtoReceituario: text('produto_receituario'),
  refReceituario: text('ref_receituario'),
});

export const productFiscal = pgTable('product_fiscal', {
  productId: text('product_id').primaryKey().references(() => products.id, { onDelete: 'cascade' }),
  ncm: text('ncm'),
  cest: text('cest'),
  categoria: text('categoria'),
  cstPisCofins: text('cst_pis_cofins'),
  aliquotaCheia: numeric('aliquota_cheia', { precision: 6, scale: 4 }),
  aliquotaFcp: numeric('aliquota_fcp', { precision: 6, scale: 4 }),
  aliquotaPis: numeric('aliquota_pis', { precision: 6, scale: 4 }),
  aliquotaCofins: numeric('aliquota_cofins', { precision: 6, scale: 4 }),
  reducaoIcms: numeric('reducao_icms', { precision: 6, scale: 4 }),
  icms: numeric('icms', { precision: 6, scale: 4 }),
});

export const promocoes = pgTable('promocoes', {
  id: text('id').primaryKey().$defaultFn(() => uuidv7()),
  productLojaId: text('product_loja_id').notNull().references(() => productLojas.id, { onDelete: 'cascade' }),
  tipo: text('tipo').notNull(), // 'valor' | 'desconto'
  valor: numeric('valor', { precision: 12, scale: 2 }),
  descontoPct: numeric('desconto_pct', { precision: 6, scale: 4 }),
  horaInicio: text('hora_inicio'),
  horaFim: text('hora_fim'),
  seg: boolean('seg').notNull().default(false),
  ter: boolean('ter').notNull().default(false),
  qua: boolean('qua').notNull().default(false),
  qui: boolean('qui').notNull().default(false),
  sex: boolean('sex').notNull().default(false),
  sab: boolean('sab').notNull().default(false),
  dom: boolean('dom').notNull().default(false),
  descontoAte: text('desconto_ate'),
});
