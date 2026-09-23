import { inject, injectable } from 'tsyringe';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { GiuliaSiaService } from './giulia-sia.service';

@injectable()
export class GiuliaSiaController {
  constructor(@inject(GiuliaSiaService) private service: GiuliaSiaService) {}
  private admin(request: FastifyRequest) {
    return exigirTela(request.currentUser, 'giulia-sia');
  }
  async previa(request: FastifyRequest, reply: FastifyReply) {
    this.admin(request); const r = await this.service.previa();
    return reply.send(buildResponse(r, `${r.resumo['conciliar-sia']} encontrado(s) no SIA; ${r.resumo['novo-codigo']} receberão novo código.`));
  }
  async aplicar(request: FastifyRequest<{ Body: { confirmacao: string } }>, reply: FastifyReply) {
    const r = await this.service.aplicar(this.admin(request), request.body.confirmacao);
    return reply.send(buildResponse(r, `${r.aplicadas} código(s) aplicados.`));
  }
}
