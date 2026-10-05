import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import { AppError, buildResponse } from '@/config/api.replies';
import { PesaveisMaintenanceService } from './pesaveis-maintenance.service';

@injectable()
export class PesaveisMaintenanceController {
  constructor(@inject(PesaveisMaintenanceService) private service: PesaveisMaintenanceService) {}

  private async arquivo(request: FastifyRequest) {
    exigirTela(request.currentUser, 'manutencao');
    const arquivo = await request.file();
    if (!arquivo) throw new AppError('Envie a exportação do SIA.', 400);
    const conteudo = await arquivo.toBuffer();
    const campos = arquivo.fields as Record<string, { value?: string } | undefined>;
    return {
      conteudo, nome: arquivo.filename || 'exportacao.xls',
      confirmacao: String(campos?.confirmacao?.value ?? ''),
      hashArquivo: String(campos?.hashArquivo?.value ?? ''),
      hashPlano: String(campos?.hashPlano?.value ?? ''),
    };
  }

  async previa(request: FastifyRequest, reply: FastifyReply) {
    const { conteudo, nome } = await this.arquivo(request);
    return reply.send(buildResponse(await this.service.previa(conteudo, nome), 'Prévia sem gravação.'));
  }

  async aplicar(request: FastifyRequest, reply: FastifyReply) {
    const { conteudo, nome, confirmacao, hashArquivo, hashPlano } = await this.arquivo(request);
    const resultado = await this.service.aplicar(conteudo, nome, confirmacao, hashArquivo, hashPlano);
    return reply.send(buildResponse(resultado,
      `${resultado.produtosAtualizados} produto(s) e ${resultado.espelhosAtualizados} vínculo(s) atualizados.`));
  }
}
