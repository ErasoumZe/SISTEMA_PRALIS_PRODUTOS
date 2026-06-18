import { pgTable, text, numeric } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Tabelas de apoio (de ../docs/06-tabelas-de-apoio.md).
 * Hoje vinham de outra planilha via IMPORTRANGE; aqui viram entidades próprias.
 */

export const gruposMercadoria = pgTable('grupos_mercadoria', {
  id: text('id').primaryKey().$defaultFn(() => uuidv7()),
  nome: text('nome').notNull(),
  tipo: text('tipo').notNull(), // 'revenda' | 'transformacao'
  margemPadrao: numeric('margem_padrao', { precision: 6, scale: 4 }), // fração; null = usa margem pontual
});

export const locaisVenda = pgTable('locais_venda', {
  id: text('id').primaryKey().$defaultFn(() => uuidv7()),
  codigo: text('codigo').notNull(), // nome do equipamento (PATRIMONIO)
  setor: text('setor'),
});

export const setores = pgTable('setores', {
  id: text('id').primaryKey().$defaultFn(() => uuidv7()),
  nome: text('nome').notNull(),
});
