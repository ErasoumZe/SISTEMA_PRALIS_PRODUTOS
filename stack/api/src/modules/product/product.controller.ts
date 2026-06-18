import { FastifyReply, FastifyRequest } from 'fastify';
import { inject, injectable } from 'tsyringe';
import { ProductService } from './product.service';
import { ProductRequests } from '@pralis/shared';
import { buildResponse } from '@/config/api.replies';

type IdParams = { id: string };

@injectable()
export class ProductController {
  constructor(@inject(ProductService) private service: ProductService) {}

  async create(
    request: FastifyRequest<{ Body: ProductRequests.CreateProductRequest }>,
    reply: FastifyReply,
  ) {
    const product = await this.service.create(request.body);
    return reply.status(201).send(buildResponse(product, 'Produto criado com sucesso'));
  }

  async list(
    request: FastifyRequest<{ Querystring: ProductRequests.ListProductQuery }>,
    reply: FastifyReply,
  ) {
    const data = await this.service.list(request.query);
    return reply.status(200).send(buildResponse(data, 'Lista de produtos'));
  }

  async getById(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) {
    const product = await this.service.getById(request.params.id);
    return reply.status(200).send(buildResponse(product, 'Detalhe do produto'));
  }

  async update(
    request: FastifyRequest<{ Params: IdParams; Body: ProductRequests.UpdateProductRequest }>,
    reply: FastifyReply,
  ) {
    const product = await this.service.update(request.params.id, request.body);
    return reply.status(200).send(buildResponse(product, 'Produto atualizado com sucesso'));
  }

  async delete(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) {
    await this.service.delete(request.params.id);
    return reply.status(200).send(buildResponse(null, 'Produto excluído com sucesso'));
  }
}
