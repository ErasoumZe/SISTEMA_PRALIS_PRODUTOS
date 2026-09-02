import { boolean, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Um grupo de linhas que provavelmente são o mesmo produto.
 *
 * Recomputável: `recalcular()` apaga e reconstrói tudo a partir do staging. Por
 * isso `chave` precisa ser estável entre recálculos — é ela que preserva a
 * decisão já tomada.
 *
 * Os flags são COLUNAS, não um jsonb: o filtro da tela roda no servidor sobre os
 * ~4.300 grupos, e filtrar dentro de jsonb seria lento e sem índice.
 */
export const unifGrupo = pgTable(
  'unif_grupo',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    /** Menor chave forte do grupo. Estável entre recálculos. */
    chave: text('chave').notNull(),
    /** mesmo_cod_barras | mesmo_cod_interno | nome_parecido | unico */
    motivo: text('motivo').notNull(),
    fontes: text('fontes').array().notNull(),
    lojas: text('lojas').array().notNull(),

    /** Nome/custo/venda/fiscal propostos, cada campo com a fonte de origem. */
    candidato: jsonb('candidato').notNull(),
    /** Repetidos fora do jsonb só para ordenar e buscar sem abrir o documento. */
    nome: text('nome').notNull().default(''),
    nomeNormalizado: text('nome_normalizado').notNull().default(''),
    grupo: text('grupo'),
    ativo: boolean('ativo').notNull().default(true),

    flagNomesDivergentes: boolean('flag_nomes_divergentes').notNull().default(false),
    flagSemFiscalTnp: boolean('flag_sem_fiscal_tnp').notNull().default(false),
    flagSemBarras: boolean('flag_sem_barras').notNull().default(false),
    flagBarrasConflitante: boolean('flag_barras_conflitante').notNull().default(false),
    flagSemGrupo: boolean('flag_sem_grupo').notNull().default(false),
    flagJaNoPralis: boolean('flag_ja_no_pralis').notNull().default(false),

    /**
     * Nulo = ninguém decidiu ainda. Preenchido na Fatia 3 e PRESERVADO entre
     * recálculos pela `chave` — recomputar não pode apagar decisão humana.
     */
    decisao: text('decisao'),
    decididoPor: text('decidido_por'),
    decididoEm: timestamp('decidido_em', { withTimezone: true }),

    calculadoEm: timestamp('calculado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_unif_grupo_chave').on(t.chave),
    index('idx_unif_grupo_motivo').on(t.motivo),
    index('idx_unif_grupo_nome_norm').on(t.nomeNormalizado),
    index('idx_unif_grupo_decisao').on(t.decisao),
    index('idx_unif_grupo_revisar').on(t.flagNomesDivergentes, t.flagSemFiscalTnp, t.flagSemGrupo),
  ],
);

/** As linhas de fonte que caíram em cada grupo. */
export const unifGrupoItem = pgTable(
  'unif_grupo_item',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    grupoId: text('grupo_id').notNull(),
    /** `unif_fonte_produto.id` — sem FK: o staging é apagado e recarregado. */
    fonteProdutoId: text('fonte_produto_id').notNull(),
    fonte: text('fonte').notNull(),
    loja: text('loja').notNull(),
  },
  (t) => [
    index('idx_unif_grupo_item_grupo').on(t.grupoId),
    index('idx_unif_grupo_item_loja').on(t.loja),
  ],
);
