import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { VendasReportService } from './vendas-report.service';
import type { VendasSchemas } from '@pralis/shared';

type VendasReportQuery = VendasSchemas.VendasReportQuery;

export function reportStore(request: FastifyRequest, requested?: 'TNP' | 'LI'): 'TNP' | 'LI' {
  const user = request.currentUser;
  if (!user) throw new AppError('Não autenticado.', 401, 'UNAUTHENTICATED');
  if (user.role === 'admin') {
    if (!requested) throw new AppError('Administrador deve informar a loja.', 400, 'STORE_REQUIRED');
    return requested;
  }
  if (user.loja !== 'TNP' && user.loja !== 'LI') throw new AppError('Loja sem relatório nesta etapa.', 403, 'STORE_NOT_SUPPORTED');
  if (requested && requested !== user.loja) throw new AppError('Você só pode consultar sua loja.', 403, 'FORBIDDEN');
  return user.loja;
}

@injectable()
export class VendasReportController {
  constructor(@inject(VendasReportService) private service: VendasReportService) {}

  async report(request: FastifyRequest<{ Querystring: VendasReportQuery }>, reply: FastifyReply) {
    const store = reportStore(request, request.query.loja);
    const data = await this.service.report(store, request.query.inicio, request.query.fim);
    return reply.status(200).send(buildResponse(data, 'Relatório de vendas'));
  }
}

