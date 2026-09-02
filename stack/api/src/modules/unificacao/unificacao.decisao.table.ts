import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Registro de cada decisão humana na Central de Produtos.
 *
 * Existe para auditar e desfazer: guarda quem decidiu, quando, e o retrato do
 * que foi gravado. Sobrevive ao recálculo dos grupos — a `unif_grupo` é
 * reconstruída, esta não.
 */
export const unifDecisao = pgTable(
  'unif_decisao',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    /** A chave ESTÁVEL do grupo, não o id — o id muda a cada recálculo. */
    grupoChave: text('grupo_chave').notNull(),
    /** unificado | nao_e_o_mesmo | criado | ignorado */
    acao: text('acao').notNull(),
    /** Produto BASE criado, quando a ação criou algo. */
    productId: text('product_id'),
    /** O que foi gravado, para conferir depois sem depender do staging. */
    detalhe: jsonb('detalhe').notNull(),
    usuarioId: text('usuario_id'),
    usuarioNome: text('usuario_nome'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_unif_decisao_chave').on(t.grupoChave),
    index('idx_unif_decisao_produto').on(t.productId),
  ],
);
