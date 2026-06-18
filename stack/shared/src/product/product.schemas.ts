import { z } from 'zod/v4';
import {
  statusProduto, tipoProduto, loja, medidaBase, medidaCompra,
  embalagem, unidadeTransformacao, precisao, cDe, tipoPromocao,
} from './product.enums';

/**
 * Schemas de entidade (o "shape" do produto).
 * Modelo confirmado: revenda/transformação EXCLUSIVOS; dados comerciais POR LOJA.
 * Valores monetários e margens em número (margem em FRAÇÃO: 0,30 = 30%).
 */

// ---- Promoção (0..N por produto-loja) ----
export const promocaoSchema = z.object({
  id: z.uuidv7().optional(), // opcional na criação; presente na leitura
  tipo: tipoPromocao,
  valor: z.number().nullable(),         // R$, quando tipo = 'valor'
  descontoPct: z.number().nullable(),    // fração 0..1, quando tipo = 'desconto'
  horaInicio: z.string().nullable(),     // 'HH:MM'
  horaFim: z.string().nullable(),        // 'HH:MM'
  dias: z.array(z.boolean()).length(7),  // [SEG, TER, QUA, QUI, SEX, SAB, DOM]
  descontoAte: z.string().nullable(),    // ISO date
});

// ---- Dados comerciais por loja ----
export const lojaComercialSchema = z.object({
  loja,
  estoqueMin: z.number().nonnegative().nullable(),
  estoqueMax: z.number().nonnegative().nullable(),
  setorEstoque: z.string().nullable(),
  custo: z.number().nonnegative().nullable(),
  margemPontual: z.number().nullable(),  // fração
  vVendaPontual: z.number().nullable(),
  auto: z.boolean().default(false),
  localVenda1: z.string().nullable(),
  localVenda2: z.string().nullable(),
  promocoes: z.array(promocaoSchema).default([]),
});

// ---- Bloco transformação (1:1, quando tipo = 'transformacao') ----
export const transformacaoSchema = z.object({
  precisao,
  qtd: z.number().nonnegative(),
  unidade: unidadeTransformacao,
  produtoReceituario: z.string().nullable(),
  refReceituario: z.string().nullable(),
});

// ---- Bloco fiscal (1:1) ----
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
});

// ---- Produto (identidade compartilhada entre lojas) ----
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
  codigoInterno: z.string().nullable(),
  fotoUrl: z.string().nullable(),
  grupo: z.string().nullable(),           // nome do grupo de mercadoria
  tipo: tipoProduto,
  status: statusProduto.default('ativo'),
  habilitarAjuda: z.boolean().default(false),
});

// ---- Produto completo (como devolvido pela API) ----
export const selectProductSchema = baseProductSchema.extend({
  id: z.uuidv7(),
  codigo: z.string(),
  createdAt: z.string(),
  lojas: z.array(lojaComercialSchema).default([]),
  transformacao: transformacaoSchema.nullable(),
  fiscal: fiscalSchema.nullable(),
});

export type Promocao = z.infer<typeof promocaoSchema>;
export type LojaComercial = z.infer<typeof lojaComercialSchema>;
export type Transformacao = z.infer<typeof transformacaoSchema>;
export type Fiscal = z.infer<typeof fiscalSchema>;
export type ProductEntity = z.infer<typeof selectProductSchema>;
