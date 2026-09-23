import { inject, injectable } from 'tsyringe';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { DeParaUploadService, LOJAS_DEPARA } from './depara-upload.service';
import type { CreareStore } from './creare.config';

/**
 * O de-para é a régua da numeração da rede e o que o TXT do Creare consulta.
 * Substituí-lo é decisão de administrador, não de loja.
 */
@injectable()
export class DeParaUploadController {
  constructor(@inject(DeParaUploadService) private service: DeParaUploadService) {}

  private exigirAcesso(request: FastifyRequest) {
    return exigirTela(request.currentUser, 'depara-sia');
  }

  /**
   * O arquivo e os campos vêm no mesmo multipart. A leitura é sequencial: o
   * `toBuffer()` tem que acontecer antes de olhar os campos, senão o corpo já
   * foi consumido e `fields` vem vazio.
   */
  private async lerMultipart(request: FastifyRequest) {
    const arquivo = await request.file();
    if (!arquivo) throw new AppError('Nenhum arquivo enviado.', 400, 'NO_FILE');
    const conteudo = await arquivo.toBuffer();

    const campos = arquivo.fields as Record<string, { value?: string } | undefined>;
    const loja = String(campos?.loja?.value ?? '').trim().toUpperCase();
    if (!LOJAS_DEPARA.includes(loja as CreareStore)) {
      throw new AppError(`Loja inválida. Escolha uma de: ${LOJAS_DEPARA.join(', ')}.`, 400);
    }
    return {
      loja: loja as CreareStore,
      conteudo,
      nome: arquivo.filename || 'exportacao',
      confirmacao: String(campos?.confirmacao?.value ?? ''),
    };
  }

  async previa(request: FastifyRequest, reply: FastifyReply) {
    this.exigirAcesso(request);
    const { loja, conteudo, nome } = await this.lerMultipart(request);
    const r = await this.service.previa(loja, conteudo, nome);
    const problemas = r.barrasAmbiguas.length + r.coditensRepetidos.length;
    const mensagem = problemas
      ? `${problemas} problema(s) impedem a gravação — nada foi alterado`
      : `${r.linhas} linha(s) prontas para substituir as ${r.atuais} de ${loja}`;
    return reply.status(200).send(buildResponse(r, mensagem));
  }

  async aplicar(request: FastifyRequest, reply: FastifyReply) {
    this.exigirAcesso(request);
    const { loja, conteudo, nome, confirmacao } = await this.lerMultipart(request);
    const r = await this.service.aplicar(loja, conteudo, nome, confirmacao);
    return reply.status(200).send(buildResponse(
      r,
      `De-para de ${loja} substituído: ${r.gravadas} linha(s) no lugar de ${r.substituidas}.`,
    ));
  }
}
