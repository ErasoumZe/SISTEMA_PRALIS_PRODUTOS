import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import { buildResponse } from '@/config/api.replies';
import { CargaBaseService } from './carga-base.service';

/**
 * A carga zera a Base da rede inteira. Fica atrás da mesma permissão da tela
 * `importar-mix`, que é como ela aparece no menu ("Importar da planilha").
 */
@injectable()
export class CargaBaseController {
  constructor(@inject(CargaBaseService) private service: CargaBaseService) {}

  private exigirAcesso(request: FastifyRequest) {
    return exigirTela(request.currentUser, 'importar-mix');
  }

  async previa(request: FastifyRequest, reply: FastifyReply) {
    this.exigirAcesso(request);
    const previa = await this.service.previa();
    const mensagem = previa.estado === 'coluna-mudou'
      ? 'A planilha mudou de forma: confira as colunas antes de importar'
      : previa.estado !== 'ok'
        ? 'A planilha não pôde ser lida'
        : `${previa.importar} produto(s) entram, ${previa.ativos} ativos e ${previa.inativos} inativos`;
    return reply.status(200).send(buildResponse(previa, mensagem));
  }

  async importar(request: FastifyRequest<{ Body: { confirmacao: string } }>, reply: FastifyReply) {
    const user = this.exigirAcesso(request);
    const r = await this.service.importar(user, request.body.confirmacao);
    const mensagem = `Base carregada: ${r.criados} produto(s), ${r.ativos} ativos e ${r.inativos} inativos.`
      + (r.apagados ? ` ${r.apagados} cadastro(s) anteriores da Base foram apagados.` : '')
      + (r.vinculadas ? ` ${r.vinculadas} linha(s) da planilha ficaram ligadas ao produto.` : '');
    return reply.status(200).send(buildResponse(r, mensagem));
  }

  async vincular(request: FastifyRequest<{ Body: { confirmacao: string } }>, reply: FastifyReply) {
    this.exigirAcesso(request);
    const r = await this.service.vincular(request.body.confirmacao);
    const partes = [`${r.vinculadas} linha(s) ligadas ao produto.`];
    if (r.jaVinculadas) partes.push(`${r.jaVinculadas} já estavam.`);
    if (r.codigosRepetidos.length) partes.push(`${r.codigosRepetidos.length} código(s) repetido(s) ficaram de fora.`);
    return reply.status(200).send(buildResponse(r, partes.join(' ')));
  }
}
