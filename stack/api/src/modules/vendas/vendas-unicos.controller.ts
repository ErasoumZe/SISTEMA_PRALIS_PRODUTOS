import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { VendasUnicos } from '@pralis/shared';
import { buildResponse } from '@/config/api.replies';
import { VendasUnicosService, montarCsv } from './vendas-unicos.service';
import { reportStore } from './vendas-report.controller';

@injectable()
export class VendasUnicosController {
  constructor(@inject(VendasUnicosService) private service: VendasUnicosService) {}

  async listar(
    request: FastifyRequest<{ Querystring: VendasUnicos.ProdutosUnicosQuery }>,
    reply: FastifyReply,
  ) {
    // mesma regra do relatório: admin informa a loja, usuário recebe a dele
    const loja = reportStore(request, request.query.loja);
    const data = await this.service.listar(loja, request.query);
    return reply.status(200).send(buildResponse(data, 'Produtos vendidos no período'));
  }

  async csv(
    request: FastifyRequest<{ Querystring: VendasUnicos.ProdutosUnicosCsvQuery }>,
    reply: FastifyReply,
  ) {
    const loja = reportStore(request, request.query.loja);
    const produtos = await this.service.todos(loja, request.query);
    const nome = `produtos-vendidos-${loja}-${request.query.inicio}-a-${request.query.fim}.csv`;

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nome}"`)
      .header('cache-control', 'no-store')
      .status(200)
      .send(montarCsv(produtos));
  }
}
