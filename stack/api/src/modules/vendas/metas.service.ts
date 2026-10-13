import { inject, injectable } from 'tsyringe';
import { Metas, MetasSchemas, VendasRanking } from '@pralis/shared';
import { AppError } from '@/config/api.replies';
import { env } from '@/config/env';
import { MetasRepository, type DiaPorTurno, type LinhaMatriz } from './metas.repository';
import { FatorPontosService } from './fator-pontos.service';
import { MetasPlanilhaTnpSource, type MetasTnpLidas } from './metas-planilha.source';

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
const emPontosCom = (fator: number) => (reais: number) => centavos(reais * fator);
/** A régua antiga, usada quando ninguém passa outra. */
const emPontos = emPontosCom(VendasRanking.PONTOS_POR_REAL);
const emPontosOuNuloCom = (fator: number) => (reais: number | null) => (reais === null ? null : emPontosCom(fator)(reais));
const emPontosOuNulo = emPontosOuNuloCom(VendasRanking.PONTOS_POR_REAL);

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
const comoLinhaRespostaCom = (fator: number) => (linha: LinhaMatriz): MetasSchemas.MetaDiaSemana => ({
  diaSemana: linha.diaSemana,
  sigla: Metas.SIGLA_DIA[linha.diaSemana as Metas.DiaSemana],
  nome: Metas.NOME_DIA[linha.diaSemana as Metas.DiaSemana],
  ocorrencias: linha.ocorrencias,
  referenciaMedia: emPontosCom(fator)(linha.referenciaMedia),
  pctManha: linha.pctManha,
  meta: emPontosCom(fator)(linha.meta),
  metaManha: emPontosCom(fator)(linha.metaManha),
  metaTarde: emPontosCom(fator)(linha.metaTarde),
});
/** A régua padrão, para quem não passa nenhuma. */
const comoLinhaResposta = comoLinhaRespostaCom(VendasRanking.PONTOS_POR_REAL);

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
  fator: number = VendasRanking.PONTOS_POR_REAL,
): MetasSchemas.MetaTurno {
  const emPontos = emPontosCom(fator);
  const emPontosOuNulo = emPontosOuNuloCom(fator);
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
  /** A mesma régua do faturamento: meta e realizado precisam ser comparáveis. */
  fator: number = VendasRanking.PONTOS_POR_REAL,
): MetasSchemas.Metas {
  const emPontos = emPontosCom(fator);
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
    regra: 'matriz_tres_meses',
    versao,
    matriz: matriz.map(comoLinhaRespostaCom(fator)),
    turnos: {
      manha: montarTurno(doPeriodo.manha, ateAgora.manha, realizadoManha, comDinheiro, fator),
      tarde: montarTurno(doPeriodo.tarde, ateAgora.tarde, realizadoTarde, comDinheiro, fator),
      total: montarTurno(doPeriodo.total, ateAgora.total, realizadoManha + realizadoTarde, comDinheiro, fator),
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
      diasSemReferencia: [],
      planilhaLidaEm: null,
    },
  };
}

/** A regra por data da TNP; nunca reutiliza a matriz semanal de três meses. */
export function montarMetasPlanilhaTnp(
  periodo: { inicio: string; fim: string }, fonte: MetasTnpLidas,
  apurados: DiaPorTurno[], comDinheiro = false,
  fator: number = VendasRanking.PONTOS_POR_REAL,
): MetasSchemas.Metas {
  const pontos = emPontosCom(fator);
  const apuradoPorData = new Map(apurados.map((dia) => [dia.data, dia]));
  const datas = Metas.datasDe(periodo.inicio, periodo.fim);
  const diasSemReferencia: string[] = [];
  const dias = datas.map((data) => {
    const fonteDia = fonte.porData.get(data)?.meta;
    const fechado = Metas.diaSemanaDe(data) === 0;
    const calculada = fonteDia?.estado === 'calculada' ? fonteDia.valores : null;
    if (!fechado && !calculada) diasSemReferencia.push(data);
    const feito = apuradoPorData.get(data);
    return {
      data, sigla: Metas.SIGLA_DIA[Metas.diaSemanaDe(data)], aberto: !fechado && Boolean(calculada),
      meta: pontos(calculada?.total ?? 0),
      metaManha: pontos(calculada?.manha ?? 0),
      metaTarde: pontos(calculada?.tarde ?? 0),
      realizado: pontos((feito?.manha ?? 0) + (feito?.tarde ?? 0)),
      manha: pontos(feito?.manha ?? 0), tarde: pontos(feito?.tarde ?? 0),
    };
  });

  const metasReais = datas.map((data) => fonte.porData.get(data)?.meta)
    .filter((meta) => meta?.estado === 'calculada');
  const total = metasReais.reduce((s, meta) => s + meta.valores.total, 0);
  const manha = metasReais.reduce((s, meta) => s + meta.valores.manha, 0);
  const tarde = centavos(total - manha);
  const comVenda = apurados.filter((dia) => dia.manha + dia.tarde > 0);
  const datasApuradas = new Set(comVenda.map((dia) => dia.data));
  const metasApuradas = datas.filter((data) => datasApuradas.has(data))
    .map((data) => fonte.porData.get(data)?.meta)
    .filter((meta) => meta?.estado === 'calculada');
  const ateTotal = metasApuradas.reduce((s, meta) => s + meta.valores.total, 0);
  const ateManha = metasApuradas.reduce((s, meta) => s + meta.valores.manha, 0);
  const realizadoManha = comVenda.reduce((s, dia) => s + dia.manha, 0);
  const realizadoTarde = comVenda.reduce((s, dia) => s + dia.tarde, 0);
  const ultima = comVenda.at(-1)?.data ?? null;

  return {
    loja: 'TNP', periodo, regra: 'planilha_364_dias', versao: null, matriz: [], dias,
    turnos: {
      manha: montarTurno(manha, ateManha, realizadoManha, comDinheiro, fator),
      tarde: montarTurno(tarde, centavos(ateTotal - ateManha), realizadoTarde, comDinheiro, fator),
      total: montarTurno(total, ateTotal, realizadoManha + realizadoTarde, comDinheiro, fator),
    },
    fonte: {
      origem: 'planilha_ano_vs_ano_e_fechamento_caixa_dia',
      diasAbertos: dias.filter((dia) => dia.aberto).length,
      diasApurados: metasApuradas.length,
      ultimoDiaApurado: ultima,
      diasSemFechamento: dias
        .filter((dia) => dia.aberto && !apuradoPorData.has(dia.data) && dia.data <= (ultima ?? ''))
        .map((dia) => dia.data),
      diasSemReferencia,
      planilhaLidaEm: fonte.lidoEm,
    },
  };
}

@injectable()
export class MetasService {
  private readonly planilhaTnp = new MetasPlanilhaTnpSource();
  constructor(
    @inject(MetasRepository) private repository: MetasRepository,
    @inject(FatorPontosService) private fatores: FatorPontosService,
  ) {}

  async consultar(loja: Loja, query: MetasSchemas.MetasQuery, comDinheiro = false): Promise<MetasSchemas.Metas> {
    const corrente = mesCorrente();
    const periodo = { inicio: query.inicio ?? corrente.inicio, fim: query.fim ?? corrente.fim };
    validarPeriodo(periodo.inicio, periodo.fim);

    if (loja === 'TNP' && await this.repository.temMetasPlanilhaTnp()) {
      const [fonte, apurados, fator] = await Promise.all([
        this.repository.metasPlanilhaTnp(periodo.inicio, periodo.fim),
        this.repository.vendaPorTurno(loja, periodo.inicio, periodo.fim),
        this.fatores.fatorEm(loja, periodo.inicio),
      ]);
      return montarMetasPlanilhaTnp(periodo, fonte, apurados, comDinheiro, fator);
    }

    // A matriz vigente é a do INÍCIO do período: um período não pode ser cobrado
    // por duas matrizes diferentes, e a do início é a que a loja conhecia.
    const vigente = await this.repository.versaoVigente(loja, periodo.inicio);
    const apurados = await this.repository.vendaPorTurno(loja, periodo.inicio, periodo.fim);
    return montarMetas(
      loja, periodo, vigente?.versao ?? null, vigente?.matriz ?? [], apurados, comDinheiro,
      // a régua do relatório é a vigente no primeiro dia do período
      await this.fatores.fatorEm(loja, periodo.inicio),
    );
  }

  /**
   * Lê a planilha uma vez, confere cada fórmula e opcionalmente a congela.
   * A tela nunca chama Google Sheets para exibir uma meta.
   */
  async importarPlanilhaTnp(
    body: MetasSchemas.ImportarMetasPlanilhaTnpBody, importadoPor?: string | null,
  ): Promise<MetasSchemas.ImportarMetasPlanilhaTnpResult> {
    const fonte = await this.planilhaTnp.ler();
    const linhas = [...fonte.porData.values()].filter((linha) => linha.data >= body.vigenciaInicio);
    const resumo = linhas.reduce((soma, linha) => {
      if (linha.meta.estado === 'calculada') soma.calculadas += 1;
      if (linha.meta.estado === 'sem_referencia') soma.semReferencia += 1;
      if (linha.meta.estado === 'domingo_fechado') soma.domingos += 1;
      return soma;
    }, { gravadas: linhas.length, calculadas: 0, semReferencia: 0, domingos: 0 });
    const gravado = body.aplicar
      ? await this.repository.importarMetasPlanilhaTnp(fonte, env.METAS_TNP_PLANILHA_ID, body.vigenciaInicio, importadoPor)
      : resumo;
    return { aplicada: body.aplicar, vigenciaInicio: body.vigenciaInicio, ...gravado, lidaEm: fonte.lidoEm };
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
    if (body.loja === 'TNP' && (env.METAS_TNP_PLANILHA_ID || await this.repository.temMetasPlanilhaTnp())) {
      throw new AppError('A TNP usa a regra da planilha; a matriz antiga não pode ser gerada.', 409, 'METAS_REGRA_PLANILHA');
    }
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
