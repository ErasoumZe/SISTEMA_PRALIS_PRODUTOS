import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { products } from '@/modules/product/product.table';

/**
 * Estado do espelhamento de UM produto na planilha (uma linha por produto).
 * O Postgres continua sendo a fonte principal: esta tabela só registra
 * ONDE o produto foi gravado na planilha e SE a gravação deu certo.
 *
 * status: 'pending' (criado, ainda não espelhado) | 'synced' | 'failed'
 */
export const productSheetSync = pgTable('product_sheet_sync', {
  productId: text('product_id')
    .primaryKey()
    .references(() => products.id, { onDelete: 'cascade' }),
  spreadsheetId: text('spreadsheet_id').notNull(),
  sheetName: text('sheet_name').notNull(),
  rowNumber: integer('row_number'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProductSheetSyncRow = typeof productSheetSync.$inferSelect;
