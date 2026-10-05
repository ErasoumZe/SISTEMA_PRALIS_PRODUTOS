import { inject, injectable } from 'tsyringe';
import { Metas, MetasSchemas, VendasRanking } from '@pralis/shared';
import { AppError } from '@/config/api.replies';
import { MetasRepository, type DiaPorTurno, type LinhaMatriz } from './metas.repository';

type Loja = 'TNP' | 'LI';

/** Limite do período apurado. Sem teto, um pedido de cinco anos varre a tabela. */
const DIAS_MAXIMO = 400;

const centavos = (valor: number) => Math.round(valor * 100) / 100;

/**
 * Reais para pontos, na mesma régua do Relatório Gerentes.
 *
 * `PONTOS_POR_REAL` vem de `vendas-ranking.schemas` de propósito: o fator já
 * mora lá e espalhá-lo num segundo lugar viraria duas verdades no dia em que
 * alguém mudasse um só.
 */
const emPontos = (reais: number) => centavos(reais * VendasRanking.PONTOS_POR_REAL);
const emPontosOuNulo = (reais: number | null) => (reais === null ? null : emPontos(reais));

function validarPeriodo(inicio: string, fim: string) {
  const i = Date.parse(`${inicio}T00:00:00Z`);
  const f = Date.parse(`${fim}T00:00:00Z`);
  if (!Number.isFinite(i) || !Number.isFinite(f)) throw new AppError('Período inválido.', 422, 'INVALID_PERIOD');
  if (f < i) throw new AppError('O fim do período é anterior ao início.', 422, 'INVALID_PERIOD');
  if ((f - i) / 86_400_000 > DIAS_MAXIMO) {
    throw new AppError(`O período máximo é de ${DIAS_MAXIMO} dias.`, 422, 'PERIOD_TOO_LARGE');
  }
}

/** Mês corrente em São Paulo: a loja fecha o caixa no fuso dela, não em UTC. */
export function mesCorrente(agora = new Date()): { inicio: string; fim: string } {
  const local = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const ano = local.getFullYear();
  const mes = local.getMonth();
  const dois = (valor: number) => String(valor).padStart(2, '0');
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return { inicio: `${ano}-${dois(mes + 1)}-01`, fim: `${ano}-${dois(mes + 1)}-${dois(ultimo)}` };
}

const comoMetaDia = (linha: LinhaMatriz): Metas.MetaDia => ({
  diaSemana: linha.diaSemana as Metas.DiaSemana,
  ocorrencias: linha.ocorrencias,
  mediaDia: linha.referenciaMedia,
  pctManha: linha.pctManha,
  meta: linha.meta,
  metaManha: linha.metaManha,
  metaTarde: linha.metaTarde,
});

/** A matriz vai para a tela em PONTOS; em reais ela só existe no banco. */
const comoLinhaResposta = (linha: LinhaMatriz): MetasSchemas.MetaDiaSemana => ({
  diaSemana: linha.diaSemana,
  sigla: Metas.SIGLA_DIA[linha.diaSemana as Metas.DiaSemana],
  nome: Metas.NOME_DIA[linha.diaSemana as Metas.DiaSemana],
  ocorrencias: linha.ocorrencias,
  referenciaMedia: emPontos(linha.referenciaMedia),
  pctManha: linha.pctManha,
  meta: emPontos(linha.meta),
  metaManha: emPontos(linha.metaManha),
  metaTarde: emPontos(linha.metaTarde),
});

/**
 * Um cartão, EM PONTOS: meta do período, meta até a última apuração,
 * realizado, diferença, ritmo e projeção.
 *
 * As contas são feitas em reais e convertidas no fim — arredondar a meta a
 * R$ 100 só faz sentido em reais, e converter antes jogaria o arredondamento
 * para um número quebrado de pontos.
 *
 * `ritmo` é o mesmo nos dois mundos: é uma razão, e o fator se cancela.
 */
export function montarTurno(
  metaPeriodo: number, metaAteAgora: number, realizado: number, comDinheiro: boolean,
): MetasSchemas.MetaTurno {
  const projecao = Metas.projecaoFechamento(metaPeriodo, realizado, metaAteAgora);
  return {
    metaPeriodo: emPontos(metaPeriodo),
    metaAteAgora: emPontos(metaAteAgora),
    realizado: emPontos(realizado),
    diferenca: emPontos(realizado - metaAteAgora),
    ritmo: Metas.ritmo(realizado, metaAteAgora),
    projecao: emPontosOuNulo(projecao),
    reais: comDinheiro ? {
      metaPeriodo: centavos(metaPeriodo),
      metaAteAgora: centavos(metaAteAgora),
      realizado: centavos(realizado),
      diferenca: centavos(realizado - metaAteAgora),
      projecao,
    } : null,
  };
}

/**
 * Monta a resposta da tela. Função pura de propósito: recebe a matriz e os dias
 * apurados e devolve os três cartões, sem tocar em banco. É onde os testes
 * batem, porque é onde a conta mora.
 *
 * O "esperado até agora" conta só os dias que TÊM fechamento. Comparar a meta do
 * mês inteiro com três dias de venda diria que a loja está 90% abaixo, o que é
 * mentira — e era o jeito mais fácil de a tela perder a confiança de quem a usa.
 */
export function montarMetas(
  loja: Loja,
  periodo: { inicio: string; fim: string },
  versao: MetasSchemas.Metas['versao'],
  matriz: LinhaMatriz[],
  apurados: DiaPorTurno[],
  comDinheiro = false,
): MetasSchemas.Metas {
  const linhasMeta = matriz.map(comoMetaDia);
  const datas = Metas.datasDe(periodo.inicio, periodo.fim);
  const doPeriodo = Metas.metaDoPeriodo(linhasMeta, datas);

  const porData = new Map(apurados.map((dia) => [dia.data, dia]));
  const comVenda = apurados.filter((dia) => dia.manha + dia.tarde > 0);
  const datasApuradas = comVenda.map((dia) => dia.data);
  const ateAgora = Metas.metaDoPeriodo(linhasMeta, datasApuradas);

  const realizadoManha = comVenda.reduce((soma, dia) => soma + dia.manha, 0);
  const realizadoTarde = comVenda.reduce((soma, dia) => soma + dia.tarde, 0);

  const porDiaSemana = new Map(linhasMeta.map((linha) => [linha.diaSemana, linha]));
  const dias = datas.map((data) => {
    const meta = porDiaSemana.get(Metas.diaSemanaDe(data));
    const feito = porData.get(data);
    return {
      data,
      sigla: Metas.SIGLA_DIA[Metas.diaSemanaDe(data)],
      aberto: Boolean(meta),
      meta: emPontos(meta?.meta ?? 0),
      metaManha: emPontos(meta?.metaManha ?? 0),
      metaTarde: emPontos(meta?.metaTarde ?? 0),
      realizado: emPontos((feito?.manha ?? 0) + (feito?.tarde ?? 0)),
      manha: emPontos(feito?.manha ?? 0),
      tarde: emPontos(feito?.tarde ?? 0),
    };
  });

  return {
    loja,
    periodo,
    versao,
    matriz: matriz.map(comoLinhaResposta),
    turnos: {
      manha: montarTurno(doPeriodo.manha, ateAgora.manha, realizadoManha, comDinheiro),
      tarde: montarTurno(doPeriodo.tarde, ateAgora.tarde, realizadoTarde, comDinheiro),
      total: montarTurno(doPeriodo.total, ateAgora.total, realizadoManha + realizadoTarde, comDinheiro),
    },
    dias,
    fonte: {
      origem: 'fechamento_caixa_dia',
      diasAbertos: doPeriodo.dias,
      diasApurados: ateAgora.dias,
      ultimoDiaApurado: datasApuradas.at(-1) ?? null,
      diasSemFechamento: dias
        .filter((dia) => dia.aberto && !porData.has(dia.data) && dia.data <= (datasApuradas.at(-1) ?? ''))
        .map((dia) => dia.data),
    },
  };
}

@injectable()
export class MetasService {
  constructor(@inject(MetasRepository) private repository: MetasRepository) {}

  async consultar(loja: Loja, query: MetasSchemas.MetasQuery, comDinheiro = false): Promise<MetasSchemas.Metas> {
    const corrente = mesCorrente();
    const periodo = { inicio: query.inicio ?? corrente.inicio, fim: query.fim ?? corrente.fim };
    validarPeriodo(periodo.inicio, periodo.fim);

    // A matriz vigente é a do INÍCIO do período: um período não pode ser cobrado
    // por duas matrizes diferentes, e a do início é a que a loja conhecia.
    const vigente = await this.repository.versaoVigente(loja, periodo.inicio);
    const apurados = await this.repository.vendaPorTurno(loja, periodo.inicio, periodo.fim);
    return montarMetas(loja, periodo, vigente?.versao ?? null, vigente?.matriz ?? [], apurados, comDinheiro);
  }

  /**
   * Calcula a matriz a partir do realizado do período de referência.
   *
   * `previa` devolve os números sem gravar: ver antes de congelar é o que evita
   * uma versão nascida de uma janela de referência errada.
   */
  async gerar(
    body: MetasSchemas.GerarMatrizBody, criadoPor?: string,
  ): Promise<MetasSchemas.GerarMatrizResult> {
    validarPeriodo(body.referenciaInicio, body.referenciaFim);
    const dias = await this.repository.vendaPorTurno(body.loja, body.referenciaInicio, body.referenciaFim);
    const comVenda = dias.filter((dia) => dia.manha + dia.tarde > 0);
    if (!comVenda.length) {
      throw new AppError(
        'Nenhum fechamento de caixa no período de referência. Confira se o robô da loja está enviando.',
        422, 'METAS_SEM_REFERENCIA',
      );
    }

    const referencia = Metas.referenciaPonderada(comVenda);
    const matriz = Metas.aplicarCrescimento(referencia, body.crescimento);
    const linhas: LinhaMatriz[] = matriz.map((linha) => ({
      diaSemana: linha.diaSemana,
      ocorrencias: linha.ocorrencias,
      referenciaMedia: linha.mediaDia,
      pctManha: linha.pctManha,
      meta: linha.meta,
      metaManha: linha.metaManha,
      metaTarde: linha.metaTarde,
    }));

    const versaoId = body.previa ? null : await this.repository.gravar(body.loja, {
      vigenciaInicio: body.vigenciaInicio,
      crescimento: body.crescimento,
      referenciaInicio: body.referenciaInicio,
      referenciaFim: body.referenciaFim,
      observacao: body.observacao,
      criadoPor,
    }, linhas);

    const semana = matriz.reduce(
      (soma, linha) => ({
        total: soma.total + linha.meta,
        manha: soma.manha + linha.metaManha,
        tarde: soma.tarde + linha.metaTarde,
        dias: soma.dias + 1,
      }),
      { total: 0, manha: 0, tarde: 0, dias: 0 },
    );

    return {
      gravada: !body.previa,
      versaoId,
      referencia: { inicio: body.referenciaInicio, fim: body.referenciaFim, diasConsiderados: comVenda.length },
      matriz: linhas.map(comoLinhaResposta),
      semanaCompleta: {
        total: emPontos(semana.total), manha: emPontos(semana.manha), tarde: emPontos(semana.tarde), dias: semana.dias,
      },
    };
  }
}
