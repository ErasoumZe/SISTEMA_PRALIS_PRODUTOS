import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { VendasDePara } from '@pralis/shared';
import { AppError, buildResponse } from '@/config/api.replies';
import { VendasDeParaService } from './vendas-depara.service';
import { reportStore } from './vendas-report.controller';

@injectable()
export class VendasDeParaController {
  constructor(@inject(VendasDeParaService) private service: VendasDeParaService) {}

  async pendentes(
    request: FastifyRequest<{ Querystring: VendasDePara.DeParaQuery }>,
    reply: FastifyReply,
  ) {
    // mesma regra do relatório: admin informa a loja, usuário recebe a dele
    const loja = reportStore(request, request.query.loja);
    const data = await this.service.pendentes(loja, request.query.inicio, request.query.fim);
    return reply.status(200).send(buildResponse(data, 'Códigos do PDV sem produto no cadastro'));
  }

  async vincular(
    request: FastifyRequest<{ Body: VendasDePara.VincularBody }>,
    reply: FastifyReply,
  ) {
    const loja = reportStore(request, request.body.loja);
    const user = request.currentUser;
    if (!user) throw new AppError('Não autenticado.', 401, 'UNAUTHENTICATED');

    await this.service.vincular(
      loja, request.body.produtoCodigo, request.body.produto, request.body.productId, user.name,
    );
    return reply.status(200).send(buildResponse(
      null,
      request.body.productId ? 'Produto vinculado ao código do PDV' : 'Vínculo removido',
    ));
  }
}
