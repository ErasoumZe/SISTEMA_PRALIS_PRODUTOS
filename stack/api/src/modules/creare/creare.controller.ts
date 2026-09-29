import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { CreareService } from './creare.service';
import type { CreareStore } from './creare.config';

type ExportQuery = { loja?: CreareStore; limite?: number; modo?: 'completo' | 'pendentes' };

function requireUser(request: FastifyRequest): CurrentUser {
  if (!request.currentUser) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
  return request.currentUser;
}

/**
 * Sem `currentUser` significa que a requisição veio pelo token de máquina — o
 * robô da loja, que roda agendado. Nesse caminho a loja é obrigatória: não há
 * usuário de quem herdá-la.
 */
function exportStore(request: FastifyRequest<{ Querystring: ExportQuery }>): CreareStore {
  const requested = request.query.loja;
  const user = request.currentUser;

  if (!user) {
    if (!requested) throw new AppError('Informe a loja na consulta.', 400, 'CREARE_STORE_REQUIRED');
    return requested;
  }
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
    const store = exportStore(request);
    if (request.query.modo === 'pendentes') {
      const batch = await this.service.pending(store, request.query.limite);
      if (!batch) return reply.header('Cache-Control', 'no-store').status(204).send();
      const date = batch.criadoEm.toISOString().slice(0, 10).replaceAll('-', '');
      return reply
        .header('Content-Type', 'text/plain; charset=us-ascii')
        .header('Content-Disposition', `attachment; filename="produtos-${store}-${date}.txt"`)
        .header('Cache-Control', 'no-store')
        .header('X-Creare-Lote-Id', batch.id)
        .header('X-Creare-Sha256', batch.sha256)
        .header('X-Creare-Registros', String(batch.itens.length))
        .status(200)
        .send(Buffer.from(batch.conteudo, 'ascii'));
    }
    const file = await this.service.generate(store, request.query.limite);
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return reply
      .header('Content-Type', 'text/plain; charset=us-ascii')
      .header('Content-Disposition', `attachment; filename="produtos-${store}-${date}.txt"`)
      .header('Cache-Control', 'no-store')
      .status(200)
      .send(file);
  }

  async openBatch(request: FastifyRequest<{ Querystring: { loja: CreareStore } }>, reply: FastifyReply) {
    const store = exportStore(request as FastifyRequest<{ Querystring: ExportQuery }>);
    const batch = await this.service.openBatch(store);
    if (!batch) return reply.header('Cache-Control', 'no-store').status(204).send();
    return reply.header('Cache-Control', 'no-store').status(200).send(buildResponse({
      id: batch.id,
      loja: batch.loja,
      sha256: batch.sha256,
      registros: batch.itens.length,
      criadoEm: batch.criadoEm,
    }, 'Lote aguardando salvamento verificado no PC'));
  }

  async acknowledgeDelivery(request: FastifyRequest<{
    Params: { id: string };
    Querystring: { loja: CreareStore };
    Body: { sha256: string };
  }>, reply: FastifyReply) {
    const store = exportStore(request as FastifyRequest<{ Querystring: ExportQuery }>);
    const result = await this.service.acknowledgeDelivery(store, request.params.id, request.body.sha256);
    return reply.status(200).send(buildResponse(result, 'TXT salvo e verificado no PC; importacao no SIA nao confirmada'));
  }

  async confirm(request: FastifyRequest<{
    Params: { id: string };
    Querystring: { loja: CreareStore };
    Body: { sha256: string };
  }>, reply: FastifyReply) {
    const store = exportStore(request as FastifyRequest<{ Querystring: ExportQuery }>);
    const result = await this.service.confirm(store, request.params.id, request.body.sha256);
    return reply.status(200).send(buildResponse(result, 'Lote confirmado apos importacao no SIA'));
  }

  async health(request: FastifyRequest, reply: FastifyReply) {
    const user = requireUser(request);
    if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
    return reply.status(200).send(buildResponse(await this.service.health(), 'Diagnóstico da exportação Criare'));
  }
}
