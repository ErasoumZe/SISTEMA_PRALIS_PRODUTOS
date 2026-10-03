import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, buildResponse } from '@/config/api.replies';
import { VendasReportService } from './vendas-report.service';
import type { VendasSchemas, VendasPdv, VendasLista, VendasGerentes } from '@pralis/shared';
import type { VendasRanking } from '@pralis/shared';
import { VendasRankingService } from './vendas-ranking.service';
import { podeVerDinheiro, semDinheiro } from './vendas-ranking-sigilo';
import type { VendasAbc } from '@pralis/shared';
import { VendasAbcService } from './vendas-abc.service';
import { VendasReportRepository } from './vendas-report.repository';
import { montarPulso } from './vendas-pulso';
import { VendasPdvService } from './vendas-pdv.service';
import { VendasListaService } from './vendas-lista.service';
import { VendasGerentesService } from './vendas-gerentes.service';
import { VendasGerentesAreasService } from './vendas-gerentes-areas.service';
import { lojaGerentes, lojasGerentes } from './vendas-gerentes-acesso';
import { env } from '@/config/env';
import { readFile } from 'node:fs/promises';

type VendasReportQuery = VendasSchemas.VendasReportQuery;

export function reportStore(request: FastifyRequest, requested?: 'TNP' | 'LI'): 'TNP' | 'LI' {
  const user = request.currentUser;
  if (!user) throw new AppError('Não autenticado.', 401, 'UNAUTHENTICATED');
  if (user.role === 'admin') {
    if (!requested) throw new AppError('Administrador deve informar a loja.', 400, 'STORE_REQUIRED');
    return requested;
  }
  if (user.loja !== 'TNP' && user.loja !== 'LI') throw new AppError('Loja sem relatório nesta etapa.', 403, 'STORE_NOT_SUPPORTED');
  if (requested && requested !== user.loja) throw new AppError('Você só pode consultar sua loja.', 403, 'FORBIDDEN');
  return user.loja;
}

@injectable()
export class VendasReportController {
  constructor(@inject(VendasReportService) private service: VendasReportService) {}

  async report(request: FastifyRequest<{ Querystring: VendasReportQuery }>, reply: FastifyReply) {
    const store = reportStore(request, request.query.loja);
    const { setor, grupo, produto, hi, hf, pdv, granularidade } = request.query;
    const data = await this.service.report(
      store, request.query.inicio, request.query.fim, { setor, grupo, produto }, { hi, hf, pdv, granularidade },
    );
    return reply.status(200).send(buildResponse(data, 'Relatório de vendas'));
  }
}


/**
 * Ranking por dimensão — produto, grupo, setor ou PDV.
 *
 * Controller próprio, ao lado do relatório, porque compartilha a MESMA regra de
 * qual loja a pessoa pode consultar (`reportStore`). Duplicar essa regra seria
 * a porta para um usuário de loja ler a outra por uma rota nova.
 */
@injectable()
export class VendasRankingController {
  constructor(@inject(VendasRankingService) private service: VendasRankingService) {}

  async ranking(
    request: FastifyRequest<{ Querystring: VendasRanking.VendasRankingQuery }>,
    reply: FastifyReply,
  ) {
    const store = reportStore(request, request.query.loja);
    const data = await this.service.ranking(
      store,
      request.query.inicio,
      request.query.fim,
      request.query.dimensao,
      request.query.campoSetor,
      { setor: request.query.setor, grupo: request.query.grupo, produto: request.query.produto, campoSetor: request.query.campoSetor },
      { hi: request.query.hi, hf: request.query.hf, pdv: request.query.pdv },
    );
    /*
     * O corte do dinheiro acontece AQUI, na saída, e não na tela.
     *
     * O painel de setores fica num monitor à vista de quem trabalha no salão.
     * Esconder a coluna no HTML deixaria o número viajando na resposta — basta
     * abrir o navegador para lê-lo. Quem não pode ver, não recebe.
     */
    const visivel = podeVerDinheiro(request.currentUser)
      ? data
      : semDinheiro(data);
    return reply.status(200).send(buildResponse(visivel, 'Ranking de vendas'));
  }
}

@injectable()
export class VendasGerentesController {
  constructor(
    @inject(VendasGerentesService) private service: VendasGerentesService,
    @inject(VendasGerentesAreasService) private areasService: VendasGerentesAreasService,
  ) {}

  async acesso(request: FastifyRequest, reply: FastifyReply) {
    const lojas = lojasGerentes(request.currentUser, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    return reply.status(200).send(buildResponse({ lojas }, 'Lojas disponíveis no relatório gerentes'));
  }

  async relatorio(request: FastifyRequest<{ Querystring: VendasGerentes.GerentesQuery }>, reply: FastifyReply) {
    const loja = lojaGerentes(request.currentUser, request.query.loja, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    const dados = await this.service.relatorio(loja, request.query, podeVerDinheiro(request.currentUser));
    // Dinheiro e ticket so saem para contas ja autorizadas; o corte e na API.
    return reply.status(200).send(buildResponse(dados, 'Relatório gerentes'));
  }

  async planta(request: FastifyRequest<{ Querystring: { loja: 'TNP' } }>, reply: FastifyReply) {
    const loja = lojaGerentes(request.currentUser, request.query.loja, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    if (loja !== 'TNP') throw new AppError('Planta indisponível para esta loja.', 404, 'MAP_NOT_FOUND');
    const arquivo = new URL('../../../assets/mapas/tnp-unidade-catedral-sem-riscos.png', import.meta.url);
    const imagem = await readFile(arquivo);
    return reply.header('Cache-Control', 'private, max-age=3600').type('image/png').send(imagem);
  }

  async areas(request: FastifyRequest<{ Querystring: VendasGerentes.GerentesAreasQuery }>, reply: FastifyReply) {
    lojaGerentes(request.currentUser, request.query.loja, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    const dados = await this.areasService.relatorio(request.query, podeVerDinheiro(request.currentUser));
    return reply.status(200).send(buildResponse(dados, 'Pontuação por área'));
  }

  async horas(request: FastifyRequest<{ Querystring: VendasGerentes.GerentesHorasQuery }>, reply: FastifyReply) {
    const loja = lojaGerentes(request.currentUser, request.query.loja, env.ADMIN_EMAIL, env.GERENTES_PROGRAMADOR_EMAIL);
    const dados = await this.service.relatorioHoras(loja, request.query, podeVerDinheiro(request.currentUser));
    return reply.status(200).send(buildResponse(dados, 'Pontuação horária por PDV'));
  }
}

@injectable()
export class VendasPdvController {
  constructor(@inject(VendasPdvService) private service: VendasPdvService) {}

  async detalhe(request: FastifyRequest<{ Querystring: VendasPdv.DetalhePdvQuery }>, reply: FastifyReply) {
    const store = reportStore(request, request.query.loja);
    const data = await this.service.detalhe(store, request.query, podeVerDinheiro(request.currentUser));
    return reply.status(200).send(buildResponse(data, 'Detalhe do PDV'));
  }
}

/**
 * A lista de vendas, cupom a cupom. Mesma regra de loja (`reportStore`) e o
 * mesmo corte de dinheiro na saída: quem não pode ver, não recebe.
 */
@injectable()
export class VendasListaController {
  constructor(@inject(VendasListaService) private service: VendasListaService) {}

  async lista(request: FastifyRequest<{ Querystring: VendasLista.ListaVendasQuery }>, reply: FastifyReply) {
    const store = reportStore(request, request.query.loja);
    const data = await this.service.lista(store, request.query, podeVerDinheiro(request.currentUser));
    const aviso = data.disponivel
      ? `${data.total} venda(s) no período`
      : 'Nenhum item detalhado chegou desta loja ainda — o robô precisa enviar o lote venda_item_pdv';
    return reply.status(200).send(buildResponse(data, aviso));
  }

  async detalhe(request: FastifyRequest<{ Querystring: VendasLista.VendaDetalheQuery }>, reply: FastifyReply) {
    const store = reportStore(request, request.query.loja);
    const data = await this.service.detalhe(store, request.query.vendaIdErp, podeVerDinheiro(request.currentUser));
    return reply.status(200).send(buildResponse(data, `Venda ${data.vendaIdErp}`));
  }
}

/**
 * A lista de produtos da curva ABC. Controller próprio, mesma regra de loja.
 */
@injectable()
export class VendasAbcController {
  constructor(@inject(VendasAbcService) private service: VendasAbcService) {}

  async produtos(
    request: FastifyRequest<{ Querystring: VendasAbc.AbcProdutosQuery }>,
    reply: FastifyReply,
  ) {
    const store = request.query.loja === 'BASE'
      ? (() => {
        if (request.currentUser?.role !== 'admin') {
          throw new AppError('Catálogo Base disponível apenas para administradores.', 403, 'FORBIDDEN');
        }
        return 'BASE' as const;
      })()
      : reportStore(request, request.query.loja);
    const data = await this.service.produtos(
      store, request.query.inicio, request.query.fim, request.query.classe,
      { setor: request.query.setor, grupo: request.query.grupo, produto: request.query.produto },
      { hi: request.query.hi, hf: request.query.hf, pdv: request.query.pdv },
    );
    return reply.status(200).send(buildResponse(data, 'Produtos da curva ABC'));
  }
}

/**
 * O pulso da importação. Aberto a qualquer sessão autenticada de propósito:
 * é sinal de saúde do sistema, não dado de negócio — não traz valor nenhum,
 * só datas. Quem vê a tela de vendas precisa saber que o dado está velho.
 */
@injectable()
export class VendasPulsoController {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  async pulso(request: FastifyRequest, reply: FastifyReply) {
    if (!request.currentUser) throw new AppError('Não autenticado.', 401, 'UNAUTHENTICATED');
    const leituras = await this.repository.pulsoDasFontes();
    /* Data pelo relógio do servidor, em UTC — a mesma base das colunas `date`. */
    const hoje = new Date().toISOString().slice(0, 10);
    return reply.status(200).send(buildResponse(montarPulso(leituras, hoje), 'Pulso da importação'));
  }
}
