import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildResponse } from '@/config/api.replies';
import { VendasService } from './vendas.service';
import type { ImportarVendasBody } from './vendas.schemas';

@injectable()
export class VendasController {
  constructor(@inject(VendasService) private service: VendasService) {}

  async importar(request: FastifyRequest<{ Body: ImportarVendasBody }>, reply: FastifyReply) {
    const result = await this.service.importar(request.body);
    return reply.status(200).send(buildResponse(result, 'Lote de vendas processado'));
  }
}

