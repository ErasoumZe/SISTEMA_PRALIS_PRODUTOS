import { z } from 'zod/v4';
import { tipoProduto, statusProduto, catalogo } from './product.enums';
import {
  baseProductSchema, promocaoSchema, transformacaoSchema, fiscalSchema,
} from './product.schemas';

/**
 * A LOJA do produto NÃO vem do cliente — o servidor define pela loja do usuário logado.
 */

export const createProductSchema = baseProductSchema
  .extend({
    promocoes: z.array(promocaoSchema).default([]),
    transformacao: transformacaoSchema.nullable().optional(),
    fiscal: fiscalSchema.nullable().optional(),
    // se true, ignora o aviso de duplicado e cadastra mesmo assim
    forcar: z.boolean().optional(),
    // catálogo de destino — só admin pode escolher (BASE/TNP/LI/HORA);
    // ignorado para usuário comum (vai sempre para a loja dele). Default do admin: BASE.
    loja: catalogo.optional(),
  })
  .refine((d) => d.tipo !== 'transformacao' || !!d.transformacao, {
    message: 'Produto de transformação exige o bloco de transformação.',
    path: ['transformacao'],
  });
export type CreateProductRequest = z.infer<typeof createProductSchema>;

export const updateProductSchema = baseProductSchema.partial().extend({
  promocoes: z.array(promocaoSchema).optional(),
  transformacao: transformacaoSchema.nullable().optional(),
  fiscal: fiscalSchema.nullable().optional(),
});
export type UpdateProductRequest = z.infer<typeof updateProductSchema>;

export const listProductQuerySchema = z.object({
  q: z.string().optional(),
  tipo: tipoProduto.optional(),
  status: statusProduto.optional(),
  // só admin pode listar outro catálogo; ignorado para usuários comuns
  loja: catalogo.optional(),
});
export type ListProductQuery = z.infer<typeof listProductQuerySchema>;

export const productIdParamSchema = z.object({ id: z.uuidv7() });
export type ProductIdParam = z.infer<typeof productIdParamSchema>;

/** Importar produtos da BASE para a loja do usuário. */
export const importProductsSchema = z.object({
  baseIds: z.array(z.uuidv7()).min(1, 'Selecione ao menos um produto'),
});
export type ImportProductsRequest = z.infer<typeof importProductsSchema>;
