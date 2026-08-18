import { FastifyReply, FastifyRequest } from 'fastify';
import { inject, injectable } from 'tsyringe';
import { ProductSheetService } from './product-sheet.service';
import { buildResponse, AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';

/** Rotas exclusivas de administrador. */
function requireAdmin(request: FastifyRequest): CurrentUser {
  const user = request.currentUser;
  if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
  if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores', 403, 'FORBIDDEN');
  return user;
}

@injectable()
export class ProductSheetController {
  constructor(@inject(ProductSheetService) private service: ProductSheetService) {}

  /** Reprocessa o espelhamento. Idempotente: serve para pending, failed e synced. */
  async sync(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    requireAdmin(request);
    const result = await this.service.syncProduct(request.params.id);
    return reply.status(200).send(
      buildResponse(
        { status: result.outcome, rowNumber: result.rowNumber, error: result.error ?? null },
        result.message,
      ),
    );
  }

  /** Diagnóstico SOMENTE LEITURA — não escreve nada na planilha. */
  async health(request: FastifyRequest, reply: FastifyReply) {
    requireAdmin(request);
    const health = await this.service.health();
    return reply
      .status(200)
      .send(buildResponse(health, health.ok ? 'Planilha acessível e cabeçalhos conferidos' : 'Integração indisponível'));
  }
}
