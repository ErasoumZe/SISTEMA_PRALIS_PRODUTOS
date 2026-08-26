import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { CreareService } from './creare.service';
import type { CreareStore } from './creare.config';

type ExportQuery = { loja?: CreareStore };

function requireUser(request: FastifyRequest): CurrentUser {
  if (!request.currentUser) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
  return request.currentUser;
}

function exportStore(user: CurrentUser, requested?: CreareStore): CreareStore {
  if (user.role === 'admin') {
    if (!requested) throw new AppError('Administrador deve informar a loja.', 400, 'CREARE_STORE_REQUIRED');
    return requested;
  }
  if (!user.loja) throw new AppError('Usuário não possui loja.', 403, 'NO_LOJA');
  if (requested && requested !== user.loja) {
    throw new AppError('Você só pode exportar produtos da sua loja.', 403, 'FORBIDDEN');
  }
  return user.loja;
}

@injectable()
export class CreareController {
  constructor(@inject(CreareService) private service: CreareService) {}

  async export(request: FastifyRequest<{ Querystring: ExportQuery }>, reply: FastifyReply) {
    const store = exportStore(requireUser(request), request.query.loja);
    const file = await this.service.generate(store);
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return reply
      .header('Content-Type', 'text/plain; charset=us-ascii')
      .header('Content-Disposition', `attachment; filename="produtos-${store}-${date}.txt"`)
      .header('Cache-Control', 'no-store')
      .status(200)
      .send(file);
  }

  async health(request: FastifyRequest, reply: FastifyReply) {
    const user = requireUser(request);
    if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
    return reply.status(200).send(buildResponse(this.service.health(), 'Diagnóstico da exportação Criare'));
  }
}

