import { z } from 'zod/v4';
import { tipoProduto, statusProduto, catalogo } from './product.enums';
import {
  baseProductSchema, promocaoSchema, transformacaoSchema, fiscalSchema,
} from './product.schemas';

/**
 * A LOJA do produto NÃO vem do cliente — o servidor define pela loja do usuário logado.
 */

/**
 * Estoque mínimo e máximo em função da Qt. embalagem (`qtCad`).
 *
 * O estoque é comprado e guardado em embalagem fechada, então pedir 15 quando
 * a caixa tem 10 não existe no mundo real — ou são 10, ou são 20. Com `q` = Qt.
 * embalagem:
 *  - mínimo: múltiplo de `q` e pelo menos `q` (uma embalagem inteira);
 *  - máximo: múltiplo de `q` e ESTRITAMENTE maior que o mínimo.
 *
 * `q = 1` (o padrão) faz a regra virar só "máximo maior que mínimo", que é o
 * comportamento de quem não trabalha com embalagem fechada.
 *
 * Campo ausente ou nulo não é validado: em atualização parcial só dá para
 * conferir o que veio no payload.
 */
export function validarEstoquePorEmbalagem(
  d: { qtCad?: number | null; estoqueMin?: number | null; estoqueMax?: number | null },
  ctx: z.RefinementCtx,
): void {
  const q = d.qtCad ?? null;
  const min = d.estoqueMin ?? null;
  const max = d.estoqueMax ?? null;
  const multiplo = (v: number, base: number) => Number.isInteger(v / base);

  if (q != null && q > 0) {
    if (min != null && min > 0) {
      if (min < q) {
        ctx.addIssue({
          code: 'custom',
          path: ['estoqueMin'],
          message: `Estoque mínimo não pode ser menor que a Qt. embalagem (${q}). Use ${q} ou mais.`,
        });
      } else if (!multiplo(min, q)) {
        ctx.addIssue({
          code: 'custom',
          path: ['estoqueMin'],
          message: `Estoque mínimo deve ser múltiplo da Qt. embalagem (${q}). Ex.: ${q}, ${q * 2}, ${q * 3}.`,
        });
      }
    }
    if (max != null && max > 0 && !multiplo(max, q)) {
      ctx.addIssue({
        code: 'custom',
        path: ['estoqueMax'],
        message: `Estoque máximo deve ser múltiplo da Qt. embalagem (${q}). Ex.: ${q * 2}, ${q * 3}, ${q * 4}.`,
      });
    }
  }

  // vale com ou sem embalagem: máximo igual ao mínimo não é faixa nenhuma
  if (min != null && max != null && min > 0 && max > 0 && max <= min) {
    ctx.addIssue({
      code: 'custom',
      path: ['estoqueMax'],
      message: `Estoque máximo deve ser maior que o mínimo (${min}).`,
    });
  }
}
/**
 * A forma do produto na criação, SEM a regra de estoque por embalagem.
 *
 * Existe separado porque a regra de múltiplos é validação de ENTRADA — ela
 * existe para impedir alguém de digitar 15 quando a caixa tem 10. Ela não é
 * invariante do dado que já existe: a base legada tem cadastros antigos que a
 * violam, e eles não podem impedir a importação.
 *
 * Use este schema para importar dado legado (`seed-base`). Para requisição de
 * usuário, use `createProductSchema`, que é este mais a regra.
 */
const formaDoProdutoNaCriacao = baseProductSchema
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

/**
 * Importação de dado legado (seed da base). Mesma forma e mesmos defaults do
 * `createProductSchema`, sem a regra de estoque.
 *
 * Não é uma brecha: nada aqui vem de requisição HTTP. É o caminho de leitura de
 * um arquivo que já existe, e um cadastro antigo torto não pode impedir a API
 * de subir — foi exatamente o que derrubou a produção em 02/09/2026.
 */
export const importProductSchema = formaDoProdutoNaCriacao;
export type ImportProductRequest = z.infer<typeof importProductSchema>;

/** Requisição de usuário: a forma acima MAIS a regra de estoque por embalagem. */
export const createProductSchema = formaDoProdutoNaCriacao
  .superRefine(validarEstoquePorEmbalagem);
export type CreateProductRequest = z.infer<typeof createProductSchema>;

export const updateProductSchema = baseProductSchema.partial().extend({
  promocoes: z.array(promocaoSchema).optional(),
  transformacao: transformacaoSchema.nullable().optional(),
  fiscal: fiscalSchema.nullable().optional(),
}).superRefine(validarEstoquePorEmbalagem);
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
