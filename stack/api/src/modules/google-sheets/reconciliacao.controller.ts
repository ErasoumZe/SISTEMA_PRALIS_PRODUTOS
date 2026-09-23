import { FastifyReply, FastifyRequest } from 'fastify';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import { inject, injectable } from 'tsyringe';
import { ReconciliacaoService } from './reconciliacao.service';
import { AppError, buildResponse } from '@/config/api.replies';

/**
 * Mesmo critério das outras rotas `/admin`: o relatório cruza o catálogo
 * INTEIRO da BASE com a planilha, então quem o lê vê o cadastro de todo mundo.
 */
function exigirAcesso(request: FastifyRequest): void {
  exigirTela(request.currentUser, 'conferir-planilha');
}

@injectable()
export class ReconciliacaoController {
  constructor(@inject(ReconciliacaoService) private service: ReconciliacaoService) {}

  /**
   * SOMENTE LEITURA. Sempre 200, inclusive quando a integração está desligada
   * ou o Google recusa: o `estado` no corpo é que diz o que houve. Um 503 aqui
   * faria a tela mostrar "erro" onde o certo é "desligado", que são coisas
   * diferentes para quem precisa decidir o que fazer.
   */
  async relatorio(
    request: FastifyRequest<{ Querystring: { limite?: number } }>,
    reply: FastifyReply,
  ) {
    exigirAcesso(request);
    const relatorio = await this.service.reconciliar({ limite: request.query.limite });
    return reply.status(200).send(buildResponse(relatorio, relatorio.mensagem));
  }
}
