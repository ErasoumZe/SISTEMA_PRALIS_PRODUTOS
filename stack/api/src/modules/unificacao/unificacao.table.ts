import { boolean, index, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Staging das fontes da unificação. NÃO é catálogo.
 *
 * Uma linha por linha de origem, com as colunas neutras que todas as fontes
 * cabem. Nada aqui é derivado: o que a fonte não traz fica nulo, e `raw` guarda
 * a linha original inteira para conferência — se alguém duvidar de um valor, dá
 * para ver exatamente o que veio no CSV.
 *
 * É descartável de propósito: o carregamento apaga e recarrega tudo. Nenhuma
 * decisão vive aqui, e apagar esta tabela não perde nada do catálogo vivo.
 */
export const unifFonteProduto = pgTable(
  'unif_fonte_produto',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    /** sia_li | compilart_tnp | planilha_tnp | fiscal_tnp | pralis */
    fonte: text('fonte').notNull(),

    /**
     * Código interno COMO VEIO. É por loja e não cruza: o interno 10000 da
     * Lisboa não é o interno 10000 da TNP.
     */
    codInterno: text('cod_interno').notNull().default(''),
    /** Código de barras como veio, com os zeros à esquerda que a fonte trouxe. */
    codBarras: text('cod_barras').notNull().default(''),
    /**
     * O mesmo código sem pontuação e sem zeros à esquerda — a forma que casa
     * entre fontes (mesma normalização de `barcodeCandidates`). Guardado aqui
     * porque indexar o campo cru não serve para casar: `00000000010000` e
     * `10000` são o mesmo produto e não casariam.
     */
    chaveBarras: text('chave_barras').notNull().default(''),

    nome: text('nome').notNull().default(''),
    /** Chave FRACA: só sugere, nunca decide sozinha. */
    nomeNormalizado: text('nome_normalizado').notNull().default(''),
    /** Nulo quando a fonte não diz (o fiscal da contabilidade não tem status). */
    ativo: boolean('ativo'),

    custo: numeric('custo', { precision: 16, scale: 4 }),
    venda: numeric('venda', { precision: 16, scale: 4 }),

    ncm: text('ncm'),
    cst: text('cst'),
    csosn: text('csosn'),
    /** Alíquota de saída do ECF. Copiada do SIA, NUNCA derivada. */
    aliqEcf: text('aliq_ecf'),
    reducao: numeric('reducao', { precision: 9, scale: 4 }),
    aliqInterna: numeric('aliq_interna', { precision: 9, scale: 4 }),
    icmsEfetivo: numeric('icms_efetivo', { precision: 9, scale: 4 }),

    /** A linha da fonte inteira, para auditoria. */
    raw: jsonb('raw').notNull(),
    carregadoEm: timestamp('carregado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_unif_fonte').on(t.fonte),
    index('idx_unif_chave_barras').on(t.chaveBarras),
    index('idx_unif_nome_normalizado').on(t.nomeNormalizado),
    index('idx_unif_fonte_interno').on(t.fonte, t.codInterno),
  ],
);
