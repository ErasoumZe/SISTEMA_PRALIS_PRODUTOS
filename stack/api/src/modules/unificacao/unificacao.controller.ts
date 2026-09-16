import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { UnificacaoService } from './unificacao.service';
import { UnificacaoGruposService, type FiltrosGrupos } from './unificacao.grupos.service';
import { UnificacaoAplicarService } from './unificacao.aplicar.service';

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
    @inject(UnificacaoAplicarService) private aplicar: UnificacaoAplicarService,
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

  /**
   * O cabeçalho da Central. Repassa o recorte dos vendidos para os totais
   * caírem no mesmo universo da lista que aparece logo abaixo deles.
   */
  async health(
    request: FastifyRequest<{ Querystring: { somenteVendidos?: boolean } }>,
    reply: FastifyReply,
  ) {
    exigirAdmin(request);
    const [staging, totais] = await Promise.all([
      this.service.health(),
      this.grupos.totais({ somenteVendidos: request.query?.somenteVendidos }),
    ]);
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

  /** Escreve no catálogo mestre. Só por clique humano. */
  async unificar(
    request: FastifyRequest<{ Params: { id: string }; Body?: { forcar?: boolean; nome?: string } }>,
    reply: FastifyReply,
  ) {
    const user = exigirAdmin(request);
    const r = await this.aplicar.unificar(
      user,
      request.params.id,
      request.body?.forcar ?? false,
      request.body?.nome,
    );
    return reply.status(201).send(buildResponse(r, 'Produto criado no cadastro do Pralis'));
  }

  async marcar(
    request: FastifyRequest<{ Params: { id: string }; Body: { acao: 'nao_e_o_mesmo' | 'ignorado' } }>,
    reply: FastifyReply,
  ) {
    const user = exigirAdmin(request);
    await this.aplicar.marcar(user, request.params.id, request.body.acao);
    return reply.status(200).send(buildResponse(null, 'Decisão registrada'));
  }

  async reabrir(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const user = exigirAdmin(request);
    await this.aplicar.reabrir(user, request.params.id);
    return reply.status(200).send(buildResponse(null, 'Grupo devolvido para a fila'));
  }

  async definirGrupo(
    request: FastifyRequest<{ Params: { id: string }; Body: { grupo: string } }>,
    reply: FastifyReply,
  ) {
    const user = exigirAdmin(request);
    await this.grupos.definirGrupo(user, request.params.id, request.body.grupo);
    return reply.status(200).send(buildResponse(null, 'Grupo de mercadoria definido'));
  }

  /**
   * Processa um lote pequeno e retomável. A seleção no servidor aceita apenas
   * casamento forte, nomes iguais, grupo conhecido e barra sem conflito.
   */
  /**
   * Quantos ainda faltam no lote automático.
   *
   * A tela precisa disto para dizer o tamanho ANTES de o José começar: sem o
   * número, "unificar todos" é um botão que ninguém sabe se leva um minuto ou
   * meia hora.
   */
  async pendentesAutomaticos(request: FastifyRequest, reply: FastifyReply) {
    exigirAdmin(request);
    const total = await this.grupos.contarAutomaticos();
    return reply.status(200).send(buildResponse({ total }, `${total} item(ns) no lote automático`));
  }

  /**
   * Quantos produtos o "criar todos os que faltam" criaria AGORA.
   *
   * Porta separada da execução de propósito: é ela que permite uma confirmação
   * honesta na tela. Um "tem certeza?" sem número não é confirmação — o José
   * não teria como saber se o clique cria 3 ou 3.000 produtos.
   */
  async pendentesACriar(
    request: FastifyRequest<{ Querystring: FiltrosGrupos }>,
    reply: FastifyReply,
  ) {
    exigirAdmin(request);
    const total = await this.grupos.contarACriar(request.query ?? {});
    return reply.status(200).send(buildResponse({ total }, `${total} produto(s) a criar`));
  }

  /**
   * Cria em lote os grupos que ainda não estão no Pralis, sob os MESMOS filtros
   * da listagem. A tela chama de novo enquanto sobrar `restantes`.
   */
  async criarFaltantes(
    request: FastifyRequest<{ Body?: FiltrosGrupos & { limite?: number } }>,
    reply: FastifyReply,
  ) {
    const user = exigirAdmin(request);
    const { limite, ...filtros } = request.body ?? {};
    const r = await this.aplicar.criarFaltantes(user, filtros, limite ?? 25);
    return reply.status(200).send(buildResponse(
      r,
      r.selecionados
        ? `${r.criados} produto(s) criado(s) no Pralis`
        : 'Nenhum produto faltando com esses filtros',
    ));
  }

  async unificarAutomaticos(
    request: FastifyRequest<{ Body?: { limite?: number } }>,
    reply: FastifyReply,
  ) {
    const user = exigirAdmin(request);
    const ids = await this.grupos.idsAutomaticos(request.body?.limite ?? 25);
    const resultados: Array<{ id: string; modo?: string; erro?: string }> = [];
    for (const id of ids) {
      try {
        const r = await this.aplicar.unificar(user, id, false);
        resultados.push({ id, modo: r.modo });
      } catch (error) {
        resultados.push({ id, erro: error instanceof Error ? error.message : 'Falha inesperada' });
      }
    }
    const falhas = resultados.filter((r) => r.erro).length;
    return reply.status(200).send(buildResponse({
      selecionados: ids.length,
      concluidos: ids.length - falhas,
      falhas,
      resultados,
    }, ids.length ? 'Lote seguro processado' : 'Nenhum item seguro pendente'));
  }
}
