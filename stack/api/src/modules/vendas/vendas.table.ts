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

export const vendaProdutoDia = pgTable(
  'venda_produto_dia',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    loja: text('loja').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    produtoCodigo: text('produto_codigo').notNull().default(''),
    produto: text('produto').notNull(),
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

