import { index, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Espelho do cadastro que JA existe no SIA, por loja.
 *
 * Existe por um motivo só: o importador do Criare decide inserir ou atualizar
 * pelo `CODITEM`. Se o Pralis mandar um código próprio, ele não atualiza — ele
 * INSERE, e duplica o catálogo inteiro. Então o `coditem` tem que vir do SIA,
 * casado por código de barras.
 *
 * Também guarda GRUPO, CST e a alíquota de saída do ECF que o produto já tem
 * lá. Não é preguiça: o banco do SIA tem foreign keys (produto.GRUPO ->
 * grupo.CODGRUPO, tributacaopiscofins.CST_PIS -> cstpis.ID). Reaproveitar o
 * valor que o produto já tem garante que a trava nunca dispara.
 *
 * Esta tabela é POPULADA POR SCRIPT a partir de uma exportação do SIA. Nada
 * dela vai versionado: são dados reais de catálogo da loja.
 */
export const siaProdutoDePara = pgTable(
  'sia_produto_depara',
  {
    id: text('id').primaryKey().$defaultFn(() => uuidv7()),
    loja: text('loja').notNull(),
    /**
     * Código de barras como está no SIA (14 posições com zeros à esquerda).
     * Guardado cru para conferência humana; o casamento usa `chaveBarras`.
     */
    codigoBarras: text('codigo_barras').notNull(),
    /**
     * O mesmo código sem pontuação e sem zeros à esquerda — a forma que o
     * Pralis usa para casar (mesma normalização de `barcodeCandidates`).
     */
    chaveBarras: text('chave_barras').notNull(),
    /** A chave do importador. Sem ele, importar duplica em vez de atualizar. */
    coditem: text('coditem').notNull(),
    descricao: text('descricao').notNull().default(''),
    /** `produto.GRUPO` no SIA — precisa existir em `grupo.CODGRUPO`. */
    codGrupo: text('cod_grupo').notNull().default(''),
    /**
     * `Alíq. Saída`: o código de tributação do ECF (10 = ST, 03 = tributado,
     * 11 = isento, 01 = uso/consumo). NÃO é derivável da situação fiscal —
     * ver `docs/creare-aliquota-ecf.md`. Vem do SIA e volta para o SIA sem ser recalculado.
     */
    aliqSaidaEcf: text('aliq_saida_ecf').notNull().default(''),
    reducao: numeric('reducao', { precision: 7, scale: 4 }),
    cstSaida: text('cst_saida').notNull().default(''),
    csosn: text('csosn').notNull().default(''),
    ncm: text('ncm').notNull().default(''),
    ativo: text('ativo').notNull().default(''),
    importadoEm: timestamp('importado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // um código de barras identifica UM produto no SIA; se a exportação trouxer
    // dois, o casamento fica ambíguo e o import recusa antes de gravar
    uniqueIndex('uq_sia_depara_barras').on(t.loja, t.chaveBarras),
    uniqueIndex('uq_sia_depara_coditem').on(t.loja, t.coditem),
    index('idx_sia_depara_loja').on(t.loja),
  ],
);
