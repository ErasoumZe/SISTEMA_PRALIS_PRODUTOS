import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { ProductController } from './product.controller';
import { ProductExportController } from './product-export.controller';
import { ProductRequests, ProductSchemas } from '@pralis/shared';
import { apiResponseSchema } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';

export async function productRoutes(app: FastifyInstance) {
  const controller = container.resolve(ProductController);
  const exportController = container.resolve(ProductExportController);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // todas as rotas exigem autenticação
  app.addHook('onRequest', authMiddleware);

  const productReply = apiResponseSchema(ProductSchemas.selectProductSchema);
  const productListReply = apiResponseSchema(z.array(ProductSchemas.selectProductSchema));
  const importReply = apiResponseSchema(z.object({
    imported: z.number(),
    skipped: z.number(),
    // faixa LI/TNP da aba geral (leiaute novo) ou aba dedicada (legado)
    espelhoLoja: z.enum(['desligado', 'sem-aba', 'espelhado', 'falhou']),
  }));
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

  // Só leitura. A resposta é o CSV cru, então a rota não declara `response`
  // (o schema de resposta padrão embrulharia o arquivo num envelope JSON).
  a.get(
    '/admin/produtos/export.csv',
    {
      schema: {
        summary: 'Exportar a base de produtos de TODAS as lojas em CSV (admin)',
        tags: ['ADMIN', 'PRODUTOS'],
      },
    },
    exportController.exportar.bind(exportController),
  );
}
