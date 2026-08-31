import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProductDuplicados } from '@pralis/shared';
import { AppError, buildResponse } from '@/config/api.replies';
import { ProductDuplicadosService } from './product-duplicados.service';
import type { CurrentUser } from '@/types/fastify-jwt';

type Catalogo = 'BASE' | 'TNP' | 'LI' | 'HORA';

/** Admin escolhe o catálogo; usuário de loja só enxerga o dele. */
export function catalogoDoDiagnostico(user: CurrentUser | undefined, pedido?: Catalogo): Catalogo {
  if (!user) throw new AppError('Não autenticado.', 401, 'UNAUTHENTICATED');
  if (user.role === 'admin') return pedido ?? 'BASE';
  if (!user.loja) throw new AppError('Usuário sem loja.', 403, 'FORBIDDEN');
  if (pedido && pedido !== user.loja) {
    throw new AppError('Você só pode ver o catálogo da sua loja.', 403, 'FORBIDDEN');
  }
  return user.loja;
}

@injectable()
export class ProductDuplicadosController {
  constructor(@inject(ProductDuplicadosService) private service: ProductDuplicadosService) {}

  async diagnosticar(
    request: FastifyRequest<{ Querystring: ProductDuplicados.DuplicadosQuery }>,
    reply: FastifyReply,
  ) {
    const loja = catalogoDoDiagnostico(request.currentUser, request.query.loja);
    const data = await this.service.diagnosticar(loja, request.query.semelhancaMinima);
    return reply.status(200).send(buildResponse(data, 'Cadastros possivelmente duplicados'));
  }
}
