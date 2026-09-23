import { inject, injectable } from 'tsyringe';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { CodigoCadastroService, type BaldeEmLote, type DecisaoPedida } from './codigo-cadastro.service';

/**
 * Reconciliação do código de cadastro com o `coditem` do SIA.
 *
 * Só admin: o código vale para a rede inteira e vai para o PDV — não é escolha
 * de uma loja.
 */
@injectable()
export class CodigoCadastroController {
  constructor(@inject(CodigoCadastroService) private service: CodigoCadastroService) {}

  private exigirAcesso(request: FastifyRequest) {
    return exigirTela(request.currentUser, 'codigo-cadastro');
  }

  async previa(request: FastifyRequest, reply: FastifyReply) {
    this.exigirAcesso(request);
    const previa = await this.service.previa();
    const decidir = previa.resumo['conflito-sia'] + previa.resumo.disputado;
    return reply.status(200).send(buildResponse(
      previa,
      `${previa.resumo.exato} pronto(s) para adotar, ${decidir} para decidir, ${previa.resumo.novo} sem par no SIA`,
    ));
  }

  async adotarExatos(
    request: FastifyRequest<{ Body: { confirmacao: string; balde?: BaldeEmLote } }>,
    reply: FastifyReply,
  ) {
    const user = this.exigirAcesso(request);
    const r = await this.service.adotarExatos(user, request.body.confirmacao, request.body.balde);
    const partes = [`${r.aplicadas} código(s) adotado(s) do SIA.`];
    if (r.conflitos) partes.push(`${r.conflitos} mudaram no meio do caminho e ficaram de fora.`);
    if (r.restantes) partes.push(`Faltam ${r.restantes} — rode de novo para continuar.`);
    return reply.status(200).send(buildResponse(r, partes.join(' ')));
  }

  async decidir(request: FastifyRequest<{ Body: DecisaoPedida }>, reply: FastifyReply) {
    const user = this.exigirAcesso(request);
    const r = await this.service.decidir(user, request.body);
    return reply.status(200).send(buildResponse(r, `Código ${r.codigo} gravado.`));
  }
}
