import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { CustoMerService } from './custo-mer.service';

/** Custo mexe no preço de venda calculado: só admin. */
@injectable()
export class CustoMerController {
  constructor(@inject(CustoMerService) private service: CustoMerService) {}

  private exigirAdmin(request: FastifyRequest) {
    const user = request.currentUser;
    if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
    if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
    return user;
  }

  async previa(request: FastifyRequest, reply: FastifyReply) {
    this.exigirAdmin(request);
    const previa = await this.service.previa();
    const mensagem = previa.estado === 'ok'
      ? `${previa.comCusto} produto(s) receberiam custo de ${previa.lancamentos} lançamento(s)`
      : 'A base de discriminação não pôde ser lida';
    return reply.status(200).send(buildResponse(previa, mensagem));
  }

  async aplicar(request: FastifyRequest<{ Body: { confirmacao: string } }>, reply: FastifyReply) {
    const user = this.exigirAdmin(request);
    const r = await this.service.aplicar(user, request.body.confirmacao);
    const partes = [`${r.aplicados} custo(s) atualizado(s).`];
    if (r.conflitos) partes.push(`${r.conflitos} mudaram no meio do caminho e ficaram de fora.`);
    if (r.restantes) partes.push(`Faltam ${r.restantes} — rode de novo para continuar.`);
    return reply.status(200).send(buildResponse(r, partes.join(' ')));
  }
}
