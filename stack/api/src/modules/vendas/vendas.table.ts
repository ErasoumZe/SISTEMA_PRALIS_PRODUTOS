import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { products } from '@/modules/product/product.table';

export const vendaProdutoDia = pgTable(
  'venda_produto_dia',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    loja: text('loja').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    produtoCodigo: text('produto_codigo').notNull().default(''),
    produto: text('produto').notNull(),
    /**
     * ID do produto no ERP (Creare). E a identidade que sobrevive a
     * renomeacao e a troca de codigo — sem ela, uma lista de produtos unicos
     * num periodo longo repete o mesmo produto sob nomes diferentes.
     * Vazio nas ~90 mil linhas anteriores a 31/08/2026; quem consulta deve
     * cair no par (codigo, produto) quando faltar.
     */
    produtoIdErp: text('produto_id_erp').notNull().default(''),
    quantidade: numeric('quantidade', { precision: 16, scale: 3 }).notNull(),
    valorUnitario: numeric('valor_unitario', { precision: 16, scale: 2 }).notNull(),
    total: numeric('total', { precision: 16, scale: 2 }).notNull(),
    hash: text('hash').notNull(),
    origemAtualizadaEm: timestamp('origem_atualizada_em', { mode: 'string' }).notNull(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_venda_produto_dia_natural').on(t.loja, t.data, t.produtoCodigo, t.produto),
    uniqueIndex('uq_venda_produto_dia_hash').on(t.hash),
    index('idx_venda_produto_dia_loja_data').on(t.loja, t.data),
  ],
);

export const fechamentoCaixaDia = pgTable(
  'fechamento_caixa_dia',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    loja: text('loja').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    pdv: text('pdv').notNull(),
    operador: text('operador').notNull(),
    natureza: text('natureza').notNull(),
    caixa: text('caixa'),
    turno: text('turno'),
    primeiraVenda: timestamp('primeira_venda', { mode: 'string' }).notNull(),
    ultimaVenda: timestamp('ultima_venda', { mode: 'string' }).notNull(),
    numeroVendas: integer('numero_vendas').notNull(),
    crediario: numeric('crediario', { precision: 16, scale: 2 }).notNull().default('0'),
    credito: numeric('credito', { precision: 16, scale: 2 }).notNull().default('0'),
    debito: numeric('debito', { precision: 16, scale: 2 }).notNull().default('0'),
    dinheiro: numeric('dinheiro', { precision: 16, scale: 2 }).notNull().default('0'),
    pix: numeric('pix', { precision: 16, scale: 2 }).notNull().default('0'),
    voucher: numeric('voucher', { precision: 16, scale: 2 }).notNull().default('0'),
    clientes: numeric('clientes', { precision: 16, scale: 2 }).notNull().default('0'),
    colaboradores: numeric('colaboradores', { precision: 16, scale: 2 }).notNull().default('0'),
    alimentacao: numeric('alimentacao', { precision: 16, scale: 2 }).notNull().default('0'),
    rouboFurto: numeric('roubo_furto', { precision: 16, scale: 2 }).notNull().default('0'),
    socios: numeric('socios', { precision: 16, scale: 2 }).notNull().default('0'),
    sobraPerda: numeric('sobra_perda', { precision: 16, scale: 2 }).notNull().default('0'),
    outros: numeric('outros', { precision: 16, scale: 2 }).notNull().default('0'),
    totalPagamento: numeric('total_pagamento', { precision: 16, scale: 2 }).notNull(),
    hash: text('hash').notNull(),
    origemAtualizadaEm: timestamp('origem_atualizada_em', { mode: 'string' }).notNull(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_fechamento_caixa_dia_natural').on(t.loja, t.data, t.pdv, t.operador),
    uniqueIndex('uq_fechamento_caixa_dia_hash').on(t.hash),
    index('idx_fechamento_caixa_dia_loja_data').on(t.loja, t.data),
  ],
);

/**
 * De-para do que NAO casou sozinho: codigo do PDV -> produto do cadastro.
 *
 * A maioria dos codigos casa por `barcodeCandidates` (EAN ou PLU de balanca)
 * sem precisar de linha aqui. Esta tabela guarda so a excecao, e so o que uma
 * PESSOA confirmou — vincular errado significa calcular margem com o custo de
 * outro produto.
 *
 * `onDelete: 'cascade'`: se o produto sai do cadastro, o vinculo perde
 * sentido. A venda continua no relatorio, apenas volta a contar como sem
 * custo — que e a verdade naquele momento.
 */
export const produtoCreare = pgTable(
  'produto_creare',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    loja: text('loja').notNull(),
    produtoCodigo: text('produto_codigo').notNull(),
    /**
     * A descricao entra na chave PELO MESMO motivo da venda: o PDV manda
     * produto sem codigo, e sem ela dois produtos distintos sem codigo
     * colidiriam num vinculo so — justamente os que mais precisam de de-para.
     */
    produto: text('produto').notNull().default(''),
    productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    confirmadoPor: text('confirmado_por'),
    confirmadoEm: timestamp('confirmado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_produto_creare_natural').on(t.loja, t.produtoCodigo, t.produto),
    index('idx_produto_creare_produto').on(t.productId),
  ],
);
