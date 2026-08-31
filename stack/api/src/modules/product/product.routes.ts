import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ProductController } from './product.controller';
import { ProductDuplicadosController } from './product-duplicados.controller';
import { ProductDuplicados } from '@pralis/shared';
import { ProductRequests, ProductSchemas } from '@pralis/shared';
import { apiResponseSchema } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';

export async function productRoutes(app: FastifyInstance) {
  const controller = container.resolve(ProductController);
  const duplicadosController = container.resolve(ProductDuplicadosController);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // todas as rotas exigem autenticação
  app.addHook('onRequest', authMiddleware);

  const productReply = apiResponseSchema(ProductSchemas.selectProductSchema);
  const productListReply = apiResponseSchema(z.array(ProductSchemas.selectProductSchema));
  const importReply = apiResponseSchema(z.object({ imported: z.number(), skipped: z.number() }));
  const okReply = apiResponseSchema(z.any());

  a.post<{ Body: ProductRequests.CreateProductRequest }>(
    '/products',
    { schema: { body: ProductRequests.createProductSchema, response: { 201: productReply }, summary: 'Criar produto (na loja do usuário)', tags: ['PRODUCTS'] } },
    controller.create.bind(controller),
  );

  a.get<{ Querystring: ProductRequests.ListProductQuery }>(
    '/products',
    { schema: { querystring: ProductRequests.listProductQuerySchema, response: { 200: productListReply }, summary: 'Listar produtos da minha loja', tags: ['PRODUCTS'] } },
    controller.list.bind(controller),
  );

  a.get<{ Querystring: ProductRequests.ListProductQuery }>(
    '/products/base',
    { schema: { querystring: ProductRequests.listProductQuerySchema, response: { 200: productListReply }, summary: 'Listar o catálogo BASE (para importar)', tags: ['PRODUCTS'] } },
    controller.listBase.bind(controller),
  );

  a.post<{ Body: ProductRequests.ImportProductsRequest }>(
    '/products/import',
    { schema: { body: ProductRequests.importProductsSchema, response: { 200: importReply }, summary: 'Importar produtos da BASE para a minha loja', tags: ['PRODUCTS'] } },
    controller.importBase.bind(controller),
  );

  a.get<{ Params: { id: string } }>(
    '/products/:id',
    { schema: { params: ProductRequests.productIdParamSchema, response: { 200: productReply }, summary: 'Detalhe do produto', tags: ['PRODUCTS'] } },
    controller.getById.bind(controller),
  );

  a.put<{ Params: { id: string }; Body: ProductRequests.UpdateProductRequest }>(
    '/products/:id',
    { schema: { params: ProductRequests.productIdParamSchema, body: ProductRequests.updateProductSchema, response: { 200: productReply }, summary: 'Atualizar produto', tags: ['PRODUCTS'] } },
    controller.update.bind(controller),
  );

  a.delete<{ Params: { id: string } }>(
    '/products/:id',
    { schema: { params: ProductRequests.productIdParamSchema, response: { 200: okReply }, summary: 'Excluir produto', tags: ['PRODUCTS'] } },
    controller.delete.bind(controller),
  );

  // SÓ LEITURA: esta fatia diagnostica, não funde nada.
  a.get<{ Querystring: ProductDuplicados.DuplicadosQuery }>(
    '/products/duplicados',
    {
      schema: {
        querystring: ProductDuplicados.duplicadosQuerySchema,
        response: { 200: apiResponseSchema(ProductDuplicados.duplicadosSchema) },
        summary: 'Cadastros possivelmente duplicados na mesma loja (somente leitura)',
        tags: ['PRODUTOS'],
      },
    },
    duplicadosController.diagnosticar.bind(duplicadosController),
  );

  a.post<{ Body: ProductDuplicados.UnificarBody }>(
    '/products/unificar',
    {
      schema: {
        body: ProductDuplicados.unificarBodySchema,
        response: { 200: apiResponseSchema(ProductDuplicados.unificarResultSchema) },
        summary: 'Unificar dois cadastros da mesma loja (não apaga: aposenta o perdedor)',
        tags: ['PRODUTOS'],
      },
    },
    duplicadosController.unificar.bind(duplicadosController),
  );

  a.post<{ Body: ProductDuplicados.RecusarBody }>(
    '/products/duplicados/recusar',
    {
      schema: {
        body: ProductDuplicados.recusarBodySchema,
        response: { 200: apiResponseSchema(z.null()) },
        summary: 'Marcar que dois cadastros NÃO são o mesmo produto',
        tags: ['PRODUTOS'],
      },
    },
    duplicadosController.recusar.bind(duplicadosController),
  );

  a.post<{ Body: ProductDuplicados.LigarBaseBody }>(
    '/products/ligar-base',
    {
      schema: {
        body: ProductDuplicados.ligarBaseBodySchema,
        response: { 200: apiResponseSchema(z.null()) },
        summary: 'Ligar um produto de loja ao catálogo Base (não copia custo nem preço)',
        tags: ['PRODUTOS'],
      },
    },
    duplicadosController.ligarBase.bind(duplicadosController),
  );
}
