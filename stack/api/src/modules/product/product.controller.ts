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
    const { sheetSync, ...product } = await this.service.create(requireUser(request), request.body);
    // O produto está salvo nos três casos; a mensagem só informa o estado do espelho.
    // `misconfigured` conta como pendente: a sincronização não aconteceu e
    // precisa acontecer depois — não é uma escolha, é configuração faltando.
    const message =
      sheetSync === 'synced'
        ? 'Produto salvo no banco e na planilha'
        : sheetSync === 'failed' || sheetSync === 'misconfigured'
          ? 'Produto salvo no banco. Sincronização com a planilha pendente'
          : 'Produto criado com sucesso';
    return reply.status(201).send(buildResponse(product, message, { sheetSync }));
  }

  async list(request: FastifyRequest<{ Querystring: ProductRequests.ListProductQuery }>, reply: FastifyReply) {
    const data = await this.service.list(requireUser(request), request.query);
    return reply.status(200).send(buildResponse(data, 'Lista de produtos'));
  }

  async listBase(request: FastifyRequest<{ Querystring: ProductRequests.ListProductQuery }>, reply: FastifyReply) {
    const data = await this.service.listBase(requireUser(request), request.query);
    return reply.status(200).send(buildResponse(data, 'Catálogo base'));
  }

  async getById(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) {
    const product = await this.service.getById(requireUser(request), request.params.id);
    return reply.status(200).send(buildResponse(product, 'Detalhe do produto'));
  }

  async update(request: FastifyRequest<{ Params: IdParams; Body: ProductRequests.UpdateProductRequest }>, reply: FastifyReply) {
    const { sheetSync, lojasAtualizadas, espelhoLoja, ...product } = await this.service.update(requireUser(request), request.params.id, request.body);
    // Mesma regra do create: a edição valeu nos três casos, a mensagem só diz
    // como ficou o espelho. Nunca pedir para editar de novo.
    const message =
      sheetSync === 'synced'
        ? 'Produto atualizado no banco e na planilha'
        : sheetSync === 'failed' || sheetSync === 'misconfigured'
          ? 'Produto atualizado no banco. Sincronização com a planilha pendente'
          : 'Produto atualizado com sucesso';
    const herdaram = lojasAtualizadas > 0
      ? ` A mudança desceu para ${lojasAtualizadas} produto(s) de loja.`
      : '';
    // No leiaute novo, "aba da loja" é a faixa LI/TNP da aba geral; no antigo,
    // é o espelho dedicado. Nos dois casos, uma falha precisa aparecer na tela.
    const aba = espelhoLoja === 'falhou'
      ? ' A aba da loja não recebeu a alteração; ela fica pendente de reenvio.'
      : '';
    return reply
      .status(200)
      .send(buildResponse(product, message + herdaram + aba, { sheetSync, lojasAtualizadas, espelhoLoja }));
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
