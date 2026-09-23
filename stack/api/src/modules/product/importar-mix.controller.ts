import { inject, injectable } from 'tsyringe';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { ImportarMixService } from './importar-mix.service';

/** Importar cria cadastro para a rede inteira: só admin. */
@injectable()
export class ImportarMixController {
  constructor(@inject(ImportarMixService) private service: ImportarMixService) {}

  private exigirAcesso(request: FastifyRequest) {
    return exigirTela(request.currentUser, 'importar-mix');
  }

  async previa(request: FastifyRequest, reply: FastifyReply) {
    this.exigirAcesso(request);
    const previa = await this.service.previa();
    const forade = Object.values(previa.pular).reduce((a, b) => a + b, 0);
    const mensagem = previa.estado === 'ok'
      ? `${previa.importar} produto(s) entrariam; ${forade} ficam de fora`
      : 'A planilha MIX não pôde ser lida';
    return reply.status(200).send(buildResponse(previa, mensagem));
  }

  async importar(request: FastifyRequest<{ Body: { confirmacao: string } }>, reply: FastifyReply) {
    const user = this.exigirAcesso(request);
    const r = await this.service.importar(user, request.body.confirmacao);
    const partes = [`${r.criados} produto(s) criado(s) na Base.`];
    if (r.falhas.length) partes.push(`${r.falhas.length} falharam.`);
    if (r.restantes) partes.push(`Faltam ${r.restantes} — rode de novo para continuar.`);
    return reply.status(200).send(buildResponse(r, partes.join(' ')));
  }
}
