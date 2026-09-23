import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { ProductZerarService } from './product-zerar.service';

@injectable()
export class ProductZerarController {
  constructor(@inject(ProductZerarService) private service: ProductZerarService) {}

  private exigirAdmin(request: FastifyRequest) {
    const user = request.currentUser;
    if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
    if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
    return user;
  }

  /** Quantos seriam apagados. A tela precisa deste número para confirmar. */
  async previa(request: FastifyRequest, reply: FastifyReply) {
    this.exigirAdmin(request);
    const previa = await this.service.previa();
    return reply.status(200).send(buildResponse(
      { ...previa, confirmacao: ProductZerarService.CONFIRMACAO },
      `${previa.apagaveis} produto(s) seriam apagados; ${previa.piloto.codigoInterno} será preservado`,
    ));
  }

  async zerar(
    request: FastifyRequest<{ Body: { confirmacao: string; totalEsperado: number } }>,
    reply: FastifyReply,
  ) {
    this.exigirAdmin(request);
    const { confirmacao, totalEsperado } = request.body;
    const r = await this.service.zerar(confirmacao, totalEsperado);
    return reply.status(200).send(buildResponse(r, `${r.apagados} produto(s) apagados; ${r.preservado.codigoInterno} foi preservado`));
  }
}
