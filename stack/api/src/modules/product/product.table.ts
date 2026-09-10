import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { users } from '@/modules/user/user.table';

/**
 * Modelo MULTI-LOJA: cada produto pertence a um catálogo (coluna `loja`: BASE/TNP/LI/HORA).
 * Os dados comerciais ficam direto na linha (cada loja tem o seu).
 * Sub-tabelas 1:1 / 1:N: transformação, fiscal, promoções.
 */
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    loja: text('loja').notNull(), // 'BASE' | 'TNP' | 'LI' | 'HORA'
    codigo: text('codigo').notNull(),
    // proveniência
    baseProductId: text('base_product_id'),
    /**
     * Quando este cadastro foi unificado em outro, aponta para o VENCEDOR.
     * Unificar não apaga: o perdedor fica com `status = 'unificado'` e some
     * das listagens, mas continua no banco — sem isso o primeiro clique errado
     * seria permanente, e quem clica é uma pessoa cansada às seis da tarde.
     */
    unificadoEmProductId: text('unificado_em_product_id'),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdByName: text('created_by_name'),
    // identidade
    nome: text('nome').notNull(),
    quantidade: numeric('quantidade', { precision: 12, scale: 3 }).notNull().default('0'),
    medidaBase: text('medida_base').notNull(),
    codigoBarras: text('codigo_barras'),
    marca: text('marca'),
    embalagem: text('embalagem'),
    cDe: text('c_de'),
    qtCad: integer('qt_cad').notNull().default(1),
    medidaCompra: text('medida_compra'),
    /**
     * A quantidade da embalagem e exata ou aproximada?
     *
     * Uma caixa de queijo nao tem 20 kg exatos. Sem essa distincao a frase de
     * "como se compra" afirma um peso certo que nao existe, e a conferencia de
     * entrada acusa diferenca que nao ha. `false` = exato, que e o comum.
     */
    compraAproximada: boolean('compra_aproximada').notNull().default(false),
    codigoInterno: text('codigo_interno'),
    fotoUrl: text('foto_url'),
    grupo: text('grupo'),
    tipo: text('tipo').notNull(), // 'revenda' | 'transformacao'
    status: text('status').notNull().default('ativo'),
    habilitarAjuda: boolean('habilitar_ajuda').notNull().default(false),
    // comercial (revenda)
    estoqueMin: numeric('estoque_min', { precision: 12, scale: 3 }),
    estoqueMax: numeric('estoque_max', { precision: 12, scale: 3 }),
    setorEstoque: text('setor_estoque'),
    custo: numeric('custo', { precision: 12, scale: 2 }),
    margemPontual: numeric('margem_pontual', { precision: 6, scale: 4 }),
    vVendaPontual: numeric('v_venda_pontual', { precision: 12, scale: 2 }),
    auto: boolean('auto').notNull().default(false),
    /**
     * Onde o produto e VENDIDO. Nao confundir com `setorEstoque`, que e onde
     * ele fica guardado — sao coisas diferentes e coexistem.
     */
    setorVenda1: text('setor_venda_1'),
    setorVenda2: text('setor_venda_2'),
    localVenda1: text('local_venda_1'),
    localVenda2: text('local_venda_2'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_products_loja').on(t.loja)],
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
  tributacaoSimples: text('tributacao_simples'),
  aliquotaSimples: numeric('aliquota_simples', { precision: 8, scale: 6 }),
  icmsRe: numeric('icms_re', { precision: 8, scale: 6 }),
  baseFiscal: text('base_fiscal'),
  codigoFiscal: text('codigo_fiscal'),
  produtoFiscal: text('produto_fiscal'),
  cstReforma: text('cst_reforma'),
  cClassTrib: text('cclass_trib'),
  aliquotaIbs: numeric('aliquota_ibs', { precision: 8, scale: 6 }),
  aliquotaCbs: numeric('aliquota_cbs', { precision: 8, scale: 6 }),
  origemFiscal: text('origem_fiscal'),
  // TEXTO: a coluna do Creare mistura "18,00%", "SUBST TRIB" e "ISENTO", e o
  // ID ("03", "10", "11") tem zero à esquerda que faz parte do código.
  aliquotaEcf: text('aliquota_ecf'),
  aliquotaEcfId: text('aliquota_ecf_id'),
});

export const promocoes = pgTable('promocoes', {
  id: text('id').primaryKey().$defaultFn(() => uuidv7()),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  tipo: text('tipo').notNull(),
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

/**
 * Auditoria da unificacao — e o que torna o desfazer possivel.
 *
 * Guarda um SNAPSHOT da linha inteira do perdedor (produto + fiscal +
 * transformacao + promocoes) antes de ele ser aposentado. Sem isso, unificar
 * errado nao teria volta: o `onDelete: 'cascade'` de product_fiscal,
 * product_transformacao, promocoes e produto_creare levaria tudo junto se um
 * dia alguem apagasse de verdade.
 */
export const productMerge = pgTable(
  'product_merge',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    loja: text('loja').notNull(),
    vencedorProductId: text('vencedor_product_id').notNull(),
    perdedorProductId: text('perdedor_product_id').notNull(),
    /** Linha inteira do perdedor no momento da unificacao. */
    snapshot: jsonb('snapshot').notNull(),
    confirmadoPor: text('confirmado_por'),
    confirmadoEm: timestamp('confirmado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_product_merge_vencedor').on(t.vencedorProductId),
    uniqueIndex('uq_product_merge_perdedor').on(t.perdedorProductId),
  ],
);

/**
 * "Estes dois NAO sao o mesmo produto."
 *
 * Sem isto, um par recusado por semelhanca de nome volta a ser sugerido toda
 * semana e a tela perde a confianca de quem usa. O par e guardado ORDENADO
 * (menor id primeiro) para que A-B e B-A sejam a mesma recusa.
 *
 * A tela de Duplicados que escrevia aqui foi apagada (a Central tem decisao
 * propria), mas ESTA TABELA FICA: o `start:prod` roda `drizzle-kit push
 * --force`, entao tirar a definicao dropa a tabela e leva junto as recusas ja
 * registradas. So sai quando alguem decidir descartar esse historico.
 */
export const productMergeRecusa = pgTable(
  'product_merge_recusa',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    loja: text('loja').notNull(),
    produtoAId: text('produto_a_id').notNull(),
    produtoBId: text('produto_b_id').notNull(),
    recusadoPor: text('recusado_por'),
    recusadoEm: timestamp('recusado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_product_merge_recusa_par').on(t.produtoAId, t.produtoBId)],
);
