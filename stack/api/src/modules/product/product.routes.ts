import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ProductController } from './product.controller';
import { ProductRequests, ProductSchemas } from '@pralis/shared';
import { apiResponseSchema } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';

export async function productRoutes(app: FastifyInstance) {
  const controller = container.resolve(ProductController);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // todas as rotas de produto exigem autenticação
  app.addHook('onRequest', authMiddleware);

  const productReply = apiResponseSchema(ProductSchemas.selectProductSchema);
  const productListReply = apiResponseSchema(z.array(ProductSchemas.selectProductSchema));
  const okReply = apiResponseSchema(z.any());

  a.post<{ Body: ProductRequests.CreateProductRequest }>(
    '/products',
    {
      schema: {
        body: ProductRequests.createProductSchema,
        response: { 201: productReply },
        summary: 'Criar produto',
        description: 'Cria um produto com dados por loja, transformação e fiscal. Gera o código (PR-XXXX-XXXX).',
        tags: ['PRODUCTS'],
      },
    },
    controller.create.bind(controller),
  );

  a.get<{ Querystring: ProductRequests.ListProductQuery }>(
    '/products',
    {
      schema: {
        querystring: ProductRequests.listProductQuerySchema,
        response: { 200: productListReply },
        summary: 'Listar produtos',
        description: 'Lista produtos com busca (q) e filtros por loja, tipo e status.',
        tags: ['PRODUCTS'],
      },
    },
    controller.list.bind(controller),
  );

  a.get<{ Params: { id: string } }>(
    '/products/:id',
    {
      schema: {
        params: ProductRequests.productIdParamSchema,
        response: { 200: productReply },
        summary: 'Detalhe do produto',
        tags: ['PRODUCTS'],
      },
    },
    controller.getById.bind(controller),
  );

  a.put<{ Params: { id: string }; Body: ProductRequests.UpdateProductRequest }>(
    '/products/:id',
    {
      schema: {
        params: ProductRequests.productIdParamSchema,
        body: ProductRequests.updateProductSchema,
        response: { 200: productReply },
        summary: 'Atualizar produto',
        tags: ['PRODUCTS'],
      },
    },
    controller.update.bind(controller),
  );

  a.delete<{ Params: { id: string } }>(
    '/products/:id',
    {
      schema: {
        params: ProductRequests.productIdParamSchema,
        response: { 200: okReply },
        summary: 'Excluir produto',
        tags: ['PRODUCTS'],
      },
    },
    controller.delete.bind(controller),
  );
}
