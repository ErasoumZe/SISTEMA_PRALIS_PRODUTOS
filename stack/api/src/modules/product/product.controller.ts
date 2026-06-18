import { FastifyReply, FastifyRequest } from 'fastify';
import { inject, injectable } from 'tsyringe';
import { ProductService } from './product.service';
import { ProductRequests } from '@pralis/shared';
import { buildResponse, AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';

type IdParams = { id: string };

function requireUser(request: FastifyRequest): CurrentUser {
  if (!request.currentUser) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
  return request.currentUser;
}

@injectable()
export class ProductController {
  constructor(@inject(ProductService) private service: ProductService) {}

  async create(request: FastifyRequest<{ Body: ProductRequests.CreateProductRequest }>, reply: FastifyReply) {
    const product = await this.service.create(requireUser(request), request.body);
    return reply.status(201).send(buildResponse(product, 'Produto criado com sucesso'));
  }

  async list(request: FastifyRequest<{ Querystring: ProductRequests.ListProductQuery }>, reply: FastifyReply) {
    const data = await this.service.list(requireUser(request), request.query);
    return reply.status(200).send(buildResponse(data, 'Lista de produtos'));
  }

  async listBase(request: FastifyRequest<{ Querystring: ProductRequests.ListProductQuery }>, reply: FastifyReply) {
    requireUser(request);
    const data = await this.service.listBase(request.query);
    return reply.status(200).send(buildResponse(data, 'Catálogo base'));
  }

  async getById(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) {
    const product = await this.service.getById(requireUser(request), request.params.id);
    return reply.status(200).send(buildResponse(product, 'Detalhe do produto'));
  }

  async update(request: FastifyRequest<{ Params: IdParams; Body: ProductRequests.UpdateProductRequest }>, reply: FastifyReply) {
    const product = await this.service.update(requireUser(request), request.params.id, request.body);
    return reply.status(200).send(buildResponse(product, 'Produto atualizado com sucesso'));
  }

  async delete(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) {
    await this.service.delete(requireUser(request), request.params.id);
    return reply.status(200).send(buildResponse(null, 'Produto excluído com sucesso'));
  }

  async importBase(request: FastifyRequest<{ Body: ProductRequests.ImportProductsRequest }>, reply: FastifyReply) {
    const result = await this.service.importFromBase(requireUser(request), request.body.baseIds);
    return reply
      .status(200)
      .send(buildResponse(result, `Importação concluída: ${result.imported} importado(s), ${result.skipped} pulado(s)`));
  }
}
