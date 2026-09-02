import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { UnificacaoService } from './unificacao.service';
import { UnificacaoGruposService, type FiltrosGrupos } from './unificacao.grupos.service';

function exigirAdmin(request: FastifyRequest): CurrentUser {
  const user = request.currentUser;
  if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
  if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');
  return user;
}

@injectable()
export class UnificacaoController {
  constructor(
    @inject(UnificacaoService) private service: UnificacaoService,
    @inject(UnificacaoGruposService) private grupos: UnificacaoGruposService,
  ) {}

  /** Apaga o staging, recarrega as 5 fontes e reconstrói os grupos. */
  async carregar(request: FastifyRequest, reply: FastifyReply) {
    exigirAdmin(request);
    const staging = await this.service.carregar();
    const totais = await this.grupos.recalcular();
    return reply.status(200).send(buildResponse({ staging, totais }, 'Fontes carregadas e grupos recalculados'));
  }

  /** Reagrupa sem recarregar os arquivos. Preserva as decisões já tomadas. */
  async recalcular(request: FastifyRequest, reply: FastifyReply) {
    exigirAdmin(request);
    return reply.status(200).send(buildResponse(await this.grupos.recalcular(), 'Grupos recalculados'));
  }

  async health(request: FastifyRequest, reply: FastifyReply) {
    exigirAdmin(request);
    const [staging, totais] = await Promise.all([this.service.health(), this.grupos.totais()]);
    return reply.status(200).send(buildResponse({ staging, totais }, 'Diagnóstico da unificação'));
  }

  async listarGrupos(
    request: FastifyRequest<{ Querystring: FiltrosGrupos }>,
    reply: FastifyReply,
  ) {
    exigirAdmin(request);
    const pagina = await this.grupos.listar(request.query);
    return reply.status(200).send(buildResponse(pagina, 'Grupos de reconciliação'));
  }
}
