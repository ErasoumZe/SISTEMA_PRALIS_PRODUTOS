import { pgTable, text, timestamp, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Uma decisão de permissão por (usuário, tela).
 *
 * **A ausência de linha significa LIBERADO.** É o oposto do costume, e é de
 * propósito: o sistema já estava em produção com todo mundo enxergando tudo, e
 * um padrão restritivo trancaria as pessoas no meio do expediente, no deploy.
 * Cada linha aqui é uma decisão que alguém tomou e assinou.
 *
 * Guarda quem alterou e quando porque tirar uma tela de alguém é uma decisão
 * de acesso: quando a pessoa reclamar que "sumiu", tem que haver resposta.
 */
export const userTelaPermissao = pgTable(
  'user_tela_permissao',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: text('user_id').notNull(),
    /** O `id` da tela em `Telas.TELAS` — texto, não enum, para o catálogo poder crescer sem migration. */
    telaId: text('tela_id').notNull(),
    permitido: boolean('permitido').notNull(),
    alteradoEm: timestamp('alterado_em', { withTimezone: true }).notNull().defaultNow(),
    alteradoPorUserId: text('alterado_por_user_id'),
    alteradoPorNome: text('alterado_por_nome'),
  },
  (t) => [
    uniqueIndex('uq_user_tela_permissao').on(t.userId, t.telaId),
    index('idx_user_tela_permissao_user').on(t.userId),
  ],
);
