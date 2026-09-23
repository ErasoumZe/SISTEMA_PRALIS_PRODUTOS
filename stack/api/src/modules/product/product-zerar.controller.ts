import { inject, injectable } from 'tsyringe';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { ProductZerarService } from './product-zerar.service';

@injectable()
export class ProductZerarController {
  constructor(@inject(ProductZerarService) private service: ProductZerarService) {}

  private exigirAcesso(request: FastifyRequest) {
    return exigirTela(request.currentUser, 'manutencao');
  }

  /** Quantos seriam apagados. A tela precisa deste número para confirmar. */
  async previa(request: FastifyRequest, reply: FastifyReply) {
    this.exigirAcesso(request);
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
    this.exigirAcesso(request);
    const { confirmacao, totalEsperado } = request.body;
    const r = await this.service.zerar(confirmacao, totalEsperado);
    return reply.status(200).send(buildResponse(r, `${r.apagados} produto(s) apagados; ${r.preservado.codigoInterno} foi preservado`));
  }
}
