import {
  date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Matriz de metas por dia da semana, GUARDADA EM VERSÕES.
 *
 * A meta sai da média dos últimos meses, e essa média anda todo dia. Se a tela
 * recalculasse na hora, a meta de um dia já vivido mudaria depois: você veria
 * R$ 24.500 em outubro e, olhando o mesmo dia em dezembro, R$ 23.800. Ninguém
 * cobra resultado de um alvo que anda para trás, e o histórico de "batemos ou
 * não" deixaria de valer.
 *
 * Por isso a matriz é congelada com data de vigência. Para mudar a referência,
 * gera-se uma versão NOVA, que vale dali em diante; a anterior fica como estava.
 */
export const metaVersao = pgTable(
  'meta_versao',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    loja: text('loja').notNull(),
    /** A partir de quando esta matriz vale. A vigente é a de maior data <= dia consultado. */
    vigenciaInicio: date('vigencia_inicio', { mode: 'string' }).notNull(),
    /** Fração: 0.1500 são 15%. Fica no dado, não no código, porque é decisão de negócio. */
    crescimento: numeric('crescimento', { precision: 6, scale: 4 }).notNull(),
    referenciaInicio: date('referencia_inicio', { mode: 'string' }).notNull(),
    referenciaFim: date('referencia_fim', { mode: 'string' }).notNull(),
    observacao: text('observacao'),
    criadoPor: text('criado_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Duas matrizes valendo no mesmo dia para a mesma loja seria meta ambígua.
    uniqueIndex('uq_meta_versao_vigencia').on(t.loja, t.vigenciaInicio),
    index('idx_meta_versao_loja_vigencia').on(t.loja, t.vigenciaInicio),
  ],
);

/**
 * Uma linha por dia da semana da versão.
 *
 * Dia da semana que a loja não abre simplesmente NÃO TEM LINHA — é assim que
 * domingo fica fora, por não haver venda na referência, em vez de uma regra
 * "fecha domingo" escrita no código. Se a loja passar a abrir, o dado traz o
 * dia de volta na versão seguinte.
 */
export const metaDiaSemana = pgTable(
  'meta_dia_semana',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    versaoId: text('versao_id').notNull().references(() => metaVersao.id, { onDelete: 'cascade' }),
    /** 0 = domingo, 6 = sábado, como `Date.getUTCDay()`. */
    diaSemana: integer('dia_semana').notNull(),
    /** Quantos dias desse dia da semana entraram na média. Amostra pequena vira aviso na tela. */
    ocorrencias: integer('ocorrencias').notNull(),
    referenciaMedia: numeric('referencia_media', { precision: 16, scale: 2 }).notNull(),
    /** Fração ponderada pelo faturamento, não média das porcentagens diárias. */
    pctManha: numeric('pct_manha', { precision: 6, scale: 4 }).notNull(),
    meta: numeric('meta', { precision: 16, scale: 2 }).notNull(),
    metaManha: numeric('meta_manha', { precision: 16, scale: 2 }).notNull(),
    metaTarde: numeric('meta_tarde', { precision: 16, scale: 2 }).notNull(),
  },
  (t) => [uniqueIndex('uq_meta_dia_semana').on(t.versaoId, t.diaSemana)],
);

/**
 * Meta diária da TNP copiada da planilha e congelada por data.
 *
 * A planilha é a fonte de cálculo, mas não é uma base transacional: editar uma
 * célula dela meses depois não pode reescrever o alvo que já foi cobrado. A
 * importação administrativa substitui somente datas a partir da vigência que o
 * administrador escolhe; o que ficou antes permanece como evidência.
 */
export const metaPlanilhaTnpDia = pgTable(
  'meta_planilha_tnp_dia',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    data: date('data', { mode: 'string' }).notNull(),
    dataBase: date('data_base', { mode: 'string' }).notNull(),
    /** calculada | domingo_fechado | sem_referencia */
    estado: text('estado').notNull(),
    base: numeric('base', { precision: 16, scale: 2 }),
    ajusteDia: numeric('ajuste_dia', { precision: 8, scale: 4 }),
    crescimentoMes: numeric('crescimento_mes', { precision: 8, scale: 4 }),
    pctManha: numeric('pct_manha', { precision: 8, scale: 4 }),
    modo: text('modo').notNull(),
    casasArredondamento: integer('casas_arredondamento').notNull(),
    metaTotal: numeric('meta_total', { precision: 16, scale: 2 }).notNull().default('0'),
    metaManha: numeric('meta_manha', { precision: 16, scale: 2 }).notNull().default('0'),
    /** Tarde residual usada na tela: total menos manhã. */
    metaTarde: numeric('meta_tarde', { precision: 16, scale: 2 }).notNull().default('0'),
    /** EG original, retido para explicar diferença de arredondamento. */
    metaTardePlanilha: numeric('meta_tarde_planilha', { precision: 16, scale: 2 }).notNull().default('0'),
    planilhaId: text('planilha_id').notNull(),
    linhaPlanilha: integer('linha_planilha').notNull(),
    lidaNaPlanilhaEm: timestamp('lida_na_planilha_em', { withTimezone: true }).notNull(),
    importadoPor: text('importado_por'),
    importadoEm: timestamp('importado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_meta_planilha_tnp_dia').on(t.data),
    index('idx_meta_planilha_tnp_data').on(t.data),
  ],
);
