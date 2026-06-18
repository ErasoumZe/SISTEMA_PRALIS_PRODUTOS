import { z } from 'zod/v4';
import { selectProductSchema } from './product.schemas';

/**
 * Schemas de saída (reply) da API.
 */

export const productReplySchema = selectProductSchema;
export type ProductReply = z.infer<typeof productReplySchema>;

export const productListReplySchema = z.object({
  data: z.array(selectProductSchema),
});
export type ProductListReply = z.infer<typeof productListReplySchema>;

export const okReplySchema = z.object({
  ok: z.boolean(),
});
export type OkReply = z.infer<typeof okReplySchema>;
