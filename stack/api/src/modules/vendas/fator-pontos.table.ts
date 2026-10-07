import {
  boolean, date, index, numeric, pgTable, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * A régua que converte reais em pontos, GUARDADA EM VERSÕES.
 *
 * Mesmo desenho de `meta_versao`, e pelo mesmo motivo: trocar a régua sem
 * vigência reescreveria o passado. O dia que o gerente anotou como 2.284
 * pontos viraria outro número, e "batemos a meta em outubro" deixaria de ser
 * verificável meses depois.
 *
 * Uma linha por (loja, data de início). A vigente num dia é a de maior
 * `vigencia_inicio` que já começou. Sem nenhuma linha, vale o padrão do
 * código (0,25), que é o que o sistema fazia antes desta tela.
 */
export const fatorPontosVersao = pgTable(
  'fator_pontos_versao',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    loja: text('loja').notNull(),
    vigenciaInicio: date('vigencia_inicio', { mode: 'string' }).notNull(),
    /**
     * Pontos por real do FATURAMENTO — e, por decisão do José em 06/10/2026,
     * também da META. Réguas diferentes fariam "quanto falta para a meta"
     * comparar grandezas medidas de formas diferentes.
     */
    faturamento: numeric('faturamento', { precision: 12, scale: 6 }).notNull(),
    /**
     * Pontos por real do TICKET MÉDIO, com campo próprio porque ainda está em
     * discussão se ele deve aparecer em reais ou em pontos. Fica guardado e
     * sem efeito enquanto `ticket_em_pontos` for falso.
     */
    ticketMedio: numeric('ticket_medio', { precision: 12, scale: 6 }).notNull(),
    ticketEmPontos: boolean('ticket_em_pontos').notNull().default(false),
    observacao: text('observacao'),
    criadoPor: text('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Duas réguas valendo no mesmo dia para a mesma loja seria pontuação ambígua.
    uniqueIndex('uq_fator_pontos_vigencia').on(t.loja, t.vigenciaInicio),
    index('idx_fator_pontos_loja_vigencia').on(t.loja, t.vigenciaInicio),
  ],
);
