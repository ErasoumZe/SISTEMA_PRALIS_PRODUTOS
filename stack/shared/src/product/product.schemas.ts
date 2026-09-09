import { z } from 'zod/v4';
import {
  statusProduto, tipoProduto, catalogo, medidaBase, medidaCompra,
  embalagem, unidadeTransformacao, precisao, cDe, tipoPromocao,
} from './product.enums';

/**
 * Modelo MULTI-LOJA: cada produto pertence a UM catálogo (BASE/TNP/LI/HORA).
 * Os dados comerciais ficam direto na linha do produto (cada loja tem o seu).
 * Margens em FRAÇÃO (0,30 = 30%).
 */

// ---- Promoção (0..N por produto) ----
export const promocaoSchema = z.object({
  id: z.uuidv7().optional(),
  tipo: tipoPromocao,
  valor: z.number().nullable(),
  descontoPct: z.number().nullable(),
  horaInicio: z.string().nullable(),
  horaFim: z.string().nullable(),
  dias: z.array(z.boolean()).length(7), // [SEG..DOM]
  descontoAte: z.string().nullable(),
});

// ---- Transformação (1:1, quando tipo = 'transformacao') ----
export const transformacaoSchema = z.object({
  precisao,
  qtd: z.number().nonnegative(),
  unidade: unidadeTransformacao,
  produtoReceituario: z.string().nullable(),
  refReceituario: z.string().nullable(),
});

// ---- Fiscal (1:1) ----
export const fiscalSchema = z.object({
  ncm: z.string().nullable(),
  cest: z.string().nullable(),
  categoria: z.string().nullable(),
  cstPisCofins: z.string().nullable(),
  aliquotaCheia: z.number().nullable(),
  aliquotaFcp: z.number().nullable(),
  aliquotaPis: z.number().nullable(),
  aliquotaCofins: z.number().nullable(),
  reducaoIcms: z.number().nullable(),
  icms: z.number().nullable(),
  // Snapshot da regra do grupo no momento do cadastro. NCM/CEST continuam
  // próprios do produto; estes quatro campos vêm do de-para fiscal.
  tributacaoSimples: z.string().nullable().default(null),
  aliquotaSimples: z.number().nullable().default(null),
  icmsRe: z.number().nullable().default(null),
  baseFiscal: z.string().nullable().default(null),
  codigoFiscal: z.string().nullable().default(null),
  produtoFiscal: z.string().nullable().default(null),
  cstReforma: z.string().nullable().default(null),
  cClassTrib: z.string().nullable().default(null),
  aliquotaIbs: z.number().nullable().default(null),
  aliquotaCbs: z.number().nullable().default(null),
  origemFiscal: z.enum(['produto', 'plu_balanca', 'grupo']).nullable().default(null),
});

// ---- Campos editáveis do produto (identidade + comercial) ----
export const baseProductSchema = z.object({
  nome: z.string().min(1),
  quantidade: z.number().nonnegative().default(0),
  medidaBase,
  codigoBarras: z.string().nullable(),
  marca: z.string().nullable(),
  embalagem: embalagem.nullable(),
  cDe: cDe.nullable(),
  qtCad: z.number().int().positive().default(1),
  medidaCompra: medidaCompra.nullable(),
  /** Quantidade da embalagem e aproximada (peso variavel), nao exata. */
  compraAproximada: z.boolean().default(false),
  codigoInterno: z.string().nullable(),
  fotoUrl: z.string().nullable(),
  grupo: z.string().nullable(),
  tipo: tipoProduto,
  status: statusProduto.default('ativo'),
  habilitarAjuda: z.boolean().default(false),
  // comercial (cada loja tem o seu)
  estoqueMin: z.number().nonnegative().nullable(),
  estoqueMax: z.number().nonnegative().nullable(),
  setorEstoque: z.string().nullable(),
  custo: z.number().nonnegative().nullable(),
  margemPontual: z.number().nullable(),
  vVendaPontual: z.number().nullable(),
  auto: z.boolean().default(false),
  /** Setor de VENDA — diferente de `setorEstoque`, que e onde o produto fica guardado. */
  /*
   * `.default(null)` e NAO so `.nullable()`: coluna nova nao pode ser
   * obrigatoria no payload. Sem o default, todo cliente e todo arquivo antigo
   * (inclusive o base-products.json do seed) passa a falhar a validacao — foi
   * o que derrubou a producao em 02/09/2026, 149 produtos x 2 campos.
   */
  setorVenda1: z.string().nullable().default(null),
  setorVenda2: z.string().nullable().default(null),
  localVenda1: z.string().nullable(),
  localVenda2: z.string().nullable(),
});

// ---- Produto completo (como devolvido pela API) ----
export const selectProductSchema = baseProductSchema.extend({
  id: z.uuidv7(),
  codigo: z.string(),
  loja: catalogo, // a qual catálogo este produto pertence
  baseProductId: z.uuidv7().nullable(), // origem, se importado da BASE
  createdByName: z.string().nullable(), // quem cadastrou (para o aviso de duplicado)
  createdAt: z.string(),
  importado: z.boolean().optional(), // só na listagem da BASE: já foi importado por alguma loja?
  promocoes: z.array(promocaoSchema).default([]),
  transformacao: transformacaoSchema.nullable(),
  fiscal: fiscalSchema.nullable(),
});

export type Promocao = z.infer<typeof promocaoSchema>;
export type Transformacao = z.infer<typeof transformacaoSchema>;
export type Fiscal = z.infer<typeof fiscalSchema>;
export type ProductEntity = z.infer<typeof selectProductSchema>;
