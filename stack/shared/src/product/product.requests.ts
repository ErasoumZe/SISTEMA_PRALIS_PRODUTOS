import { z } from 'zod/v4';
import { tipoProduto, loja, statusProduto } from './product.enums';
import {
  baseProductSchema, lojaComercialSchema, transformacaoSchema, fiscalSchema,
} from './product.schemas';

/**
 * Schemas de entrada (request) — validados na API e reusados no front.
 */

export const createProductSchema = baseProductSchema
  .extend({
    lojas: z.array(lojaComercialSchema).default([]),
    transformacao: transformacaoSchema.nullable().optional(),
    fiscal: fiscalSchema.nullable().optional(),
  })
  .refine((d) => d.tipo !== 'transformacao' || !!d.transformacao, {
    message: 'Produto de transformação exige o bloco de transformação.',
    path: ['transformacao'],
  });
export type CreateProductRequest = z.infer<typeof createProductSchema>;

export const updateProductSchema = baseProductSchema
  .partial()
  .extend({
    lojas: z.array(lojaComercialSchema).optional(),
    transformacao: transformacaoSchema.nullable().optional(),
    fiscal: fiscalSchema.nullable().optional(),
  });
export type UpdateProductRequest = z.infer<typeof updateProductSchema>;

export const listProductQuerySchema = z.object({
  q: z.string().optional(),               // busca por nome/marca/código
  loja: loja.optional(),
  tipo: tipoProduto.optional(),
  status: statusProduto.optional(),
});
export type ListProductQuery = z.infer<typeof listProductQuerySchema>;

export const productIdParamSchema = z.object({
  id: z.uuidv7(),
});
export type ProductIdParam = z.infer<typeof productIdParamSchema>;
