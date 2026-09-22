import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { HistoricalDuplicatesService } from './historical-duplicates.service';

@injectable()
export class HistoricalDuplicatesController {
  constructor(@inject(HistoricalDuplicatesService) private service: HistoricalDuplicatesService) {}

  private admin(request: FastifyRequest) {
    const user = request.currentUser;
    if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
    if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
    return user;
  }

  async previa(request: FastifyRequest, reply: FastifyReply) {
    this.admin(request);
    const dados = await this.service.previa();
    return reply.status(200).send(buildResponse(dados, `${dados.itens.length} cadastro(s) históricos analisados.`));
  }

  async unificar(
    request: FastifyRequest<{ Body: { perdedorId: string; vencedorId: string; codigoPerdedorEsperado: string; codigoVencedorEsperado: string; confirmacao: string } }>,
    reply: FastifyReply,
  ) {
    const dados = await this.service.unificar(this.admin(request), request.body);
    return reply.status(200).send(buildResponse(dados, 'Cadastro histórico unificado; o código SIA foi preservado.'));
  }

  async unificarNomesExatos(request: FastifyRequest<{ Body: { totalEsperado: number; confirmacao: string } }>, reply: FastifyReply) {
    const dados = await this.service.unificarNomesExatos(this.admin(request), request.body.totalEsperado, request.body.confirmacao);
    return reply.status(200).send(buildResponse(dados, `${dados.aplicados} nome(s) exato(s) unificado(s).`));
  }

  async unificarRevisados(request: FastifyRequest<{ Body: { itens: Array<{ perdedorId: string; vencedorId: string; codigoPerdedorEsperado: string; codigoVencedorEsperado: string; confirmacao: string }> } }>, reply: FastifyReply) {
    const dados = await this.service.unificarRevisados(this.admin(request), request.body.itens);
    return reply.status(200).send(buildResponse(dados, `${dados.aplicados} par(es) revisado(s) unificado(s).`));
  }
}
