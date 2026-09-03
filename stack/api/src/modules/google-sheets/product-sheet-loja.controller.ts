import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { ProductRepository } from '@/modules/product/product.repository';
import { ProductSheetLojaService, type LojaEspelhada } from './product-sheet-loja.service';

type Corpo = { productId: string; loja: LojaEspelhada };

function exigirAdmin(request: FastifyRequest): CurrentUser {
  const user = request.currentUser;
  if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
  if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
  return user;
}

@injectable()
export class ProductSheetLojaController {
  constructor(
    @inject(ProductSheetLojaService) private service: ProductSheetLojaService,
    @inject(ProductRepository) private products: ProductRepository,
  ) {}

  private async produto(id: string, loja: LojaEspelhada) {
    const p = await this.products.findById(id);
    if (!p) throw new AppError('Produto não encontrado.', 404, 'PRODUCT_NOT_FOUND');
    if (p.loja !== loja) {
      throw new AppError(
        `O produto é da loja ${p.loja}, não de ${loja}. O espelho de cada aba grava só os produtos daquela loja.`,
        422,
        'PRODUCT_OTHER_STORE',
      );
    }
    return p;
  }

  /** Mostra célula por célula o que gravaria. NÃO grava nada. */
  async previsualizar(request: FastifyRequest<{ Querystring: Corpo }>, reply: FastifyReply) {
    exigirAdmin(request);
    const { productId, loja } = request.query;
    const plano = await this.service.previsualizar(await this.produto(productId, loja), loja);
    return reply.status(200).send(buildResponse(plano, 'Conferência: nada foi gravado'));
  }

  /** Grava de verdade. Um produto por vez, por clique. */
  async espelhar(request: FastifyRequest<{ Body: Corpo }>, reply: FastifyReply) {
    exigirAdmin(request);
    const { productId, loja } = request.body;
    const feito = await this.service.espelhar(await this.produto(productId, loja), loja);
    return reply.status(200).send(buildResponse(feito, `Produto espelhado na aba de ${loja}`));
  }
}
