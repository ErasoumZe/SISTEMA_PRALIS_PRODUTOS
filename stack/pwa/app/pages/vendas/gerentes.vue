<script setup lang="ts">
import type { ApexOptions } from 'apexcharts';
import { VendasFormato, VendasGerentesPeriodo } from '@pralis/shared';
import type { MetasTurno, RelatorioGerentes } from '~/composables/useApi';
import { COR_META, corPdv } from '~/utils/gerentesCores';

definePageMeta({ layout: 'default' });

const api = useApi();
const { user } = useAuth();
const loja = ref<'TNP' | 'LI'>(user.value?.loja === 'LI' ? 'LI' : 'TNP');
const lojasPermitidas = ref<Array<'TNP' | 'LI'>>([]);
const carregandoAcesso = ref(true);
const erroAcesso = ref('');
const mesAtual = VendasGerentesPeriodo.mesAtualSaoPaulo();
const ano = ref(Number(mesAtual.slice(0, 4)));
const mesNumero = ref(Number(mesAtual.slice(5, 7)));
const modo = ref<VendasGerentesPeriodo.ModoGerentes>('mes');
const diaDigitado = ref('');
const semana = ref(1);
const TODOS_PDV = '__todos_os_pdvs__';
const pdv = ref(TODOS_PDV);
const pdvsHora = ref<string[]>([]);
const aba = ref<'pdvs' | 'areas' | 'metas'>('pdvs');
const ehAdmin = computed(() => user.value?.role === 'admin');

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
].map((title, index) => ({ title, value: index + 1 }));
const NOMES_SEMANAS = ['Primeira', 'Segunda', 'Terceira', 'Quarta', 'Quinta', 'Sexta'];
const mes = computed(() => `${String(ano.value).padStart(4, '0')}-${String(mesNumero.value).padStart(2, '0')}`);
const semanas = computed(() => {
  try { return VendasGerentesPeriodo.semanasDoMes(mes.value); }
  catch { return []; }
});
const opcoesSemanas = computed(() => semanas.value.map((s, i) => ({
  title: `${NOMES_SEMANAS[i]} semana · ${rotuloData(s.inicio)} a ${rotuloData(s.fim)}`,
  value: i + 1,
})));

const erroPeriodo = computed(() => {
  if (!Number.isInteger(ano.value) || ano.value < 2000 || ano.value > 2100) return 'Informe um ano válido entre 2000 e 2100.';
  try {
    VendasGerentesPeriodo.periodoGerentes(mes.value, modo.value, diaDigitado.value, semana.value);
    return '';
  } catch (error) { return error instanceof Error ? error.message : 'Período inválido.'; }
});
const periodo = computed(() => erroPeriodo.value ? null
  : VendasGerentesPeriodo.periodoGerentes(mes.value, modo.value, diaDigitado.value, semana.value));

const dados = ref<RelatorioGerentes | null>(null);
const carregando = ref(false);
const erro = ref('');
let requisicao = 0;

/**
 * As metas do mesmo recorte. Buscadas AQUI, e não dentro da aba, porque o
 * indicador "Meta semanal" vive fora dela: duas buscas da mesma coisa na mesma
 * tela seriam duas verdades esperando divergir.
 */
const metas = ref<MetasTurno | null>(null);
const carregandoMetas = ref(false);
const erroMetas = ref('');
let requisicaoMetas = 0;

async function carregarMetas() {
  const atual = ++requisicaoMetas;
  const recorte = periodo.value;
  if (!recorte || !lojasPermitidas.value.includes(loja.value)) {
    metas.value = null;
    return;
  }
  carregandoMetas.value = true;
  erroMetas.value = '';
  try {
    const resposta = await api.metasTurno({ loja: loja.value, ...recorte });
    if (atual === requisicaoMetas) metas.value = resposta;
  } catch (e: unknown) {
    if (atual !== requisicaoMetas) return;
    metas.value = null;
    erroMetas.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não foi possível carregar as metas.';
  } finally {
    if (atual === requisicaoMetas) carregandoMetas.value = false;
  }
}

async function carregar(silencioso = false) {
  const atual = ++requisicao;
  const recorte = periodo.value;
  if (!lojasPermitidas.value.includes(loja.value)) {
    dados.value = null;
    carregando.value = false;
    return;
  }
  if (!recorte) {
    dados.value = null;
    carregando.value = false;
    erro.value = '';
    return;
  }
  if (!silencioso) carregando.value = true;
  erro.value = '';
  try {
    const resposta = await api.relatorioGerentes({
      loja: loja.value,
      ...recorte,
      ...(pdv.value !== TODOS_PDV ? { pdv: pdv.value } : {}),
    });
    if (atual === requisicao) dados.value = resposta;
  } catch (e: unknown) {
    if (atual === requisicao) {
      dados.value = null;
      erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar os pontos.';
    }
  } finally { if (atual === requisicao) carregando.value = false; }
}

async function carregarAcesso() {
  if (!user.value) { lojasPermitidas.value = []; carregandoAcesso.value = false; return; }
  carregandoAcesso.value = true;
  erroAcesso.value = '';
  try {
    const acesso = await api.acessoGerentes();
    lojasPermitidas.value = acesso.lojas;
    if (acesso.lojas.length && !acesso.lojas.includes(loja.value)) loja.value = acesso.lojas[0]!;
    await Promise.all([carregar(), carregarMetas()]);
  } catch (e: unknown) {
    lojasPermitidas.value = [];
    dados.value = null;
    erroAcesso.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível verificar as lojas permitidas.';
  } finally { carregandoAcesso.value = false; }
}

onMounted(carregarAcesso);
watch(() => user.value?.id, carregarAcesso);
watch([loja, mes, modo, diaDigitado, semana, pdv], carregar);
// As metas não dependem do PDV escolhido: a meta é da loja, não de um caixa.
watch([loja, mes, modo, diaDigitado, semana], carregarMetas);
watch([ano, mesNumero], () => { semana.value = 1; diaDigitado.value = ''; });
watch([loja, mes, modo, diaDigitado, semana], () => { pdv.value = TODOS_PDV; pdvsHora.value = []; });

const opcoesPdv = computed(() => [
  { title: 'Todos os PDVs com fechamento', value: TODOS_PDV },
  ...(modo.value === 'dia' ? pdvsHora.value : dados.value?.pdvs ?? []).filter((nome) => nome.trim()).map((nome) => ({ title: nome, value: nome })),
]);
const diasComFechamento = computed(() => {
  const series = dados.value?.series ?? [];
  const datas = series[0]?.dias.map((dia) => dia.data) ?? [];
  return datas.filter((data, i) => series.some((serie) => serie.dias[i]?.pontos != null && serie.dias[i]?.data === data));
});
const temMovimento = computed(() => diasComFechamento.value.length > 0);
const apenasUmDia = computed(() => diasComFechamento.value.length === 1);
/* Ponto é placar, não dinheiro: inteiro. Ver `VendasFormato`. */
const pontos = (v: number) => VendasFormato.formatarPontos(v);
const pct = (v: number) => VendasFormato.formatarPercentual(v);
const quantidade = (v: number) => VendasFormato.formatarQuantidade(v);
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function rotuloData(iso: string) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''; }
function escaparHtml(valor: string) {
  const entidades: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return valor.replace(/[&<>"']/g, (c) => entidades[c] ?? c);
}
const NOME_SOMA = 'Soma dos PDVs';
const NOME_META = 'Meta do dia';
const COR_SOMA = '#101828';

/** A meta de cada data, vinda da matriz por dia da semana (aba Metas). */
const metaPorData = computed(() => new Map((metas.value?.dias ?? []).map((d) => [d.data, d.meta])));
const temLinhaMeta = computed(() => !!metas.value?.versao
  && diasComFechamento.value.some((data) => (metaPorData.value.get(data) ?? 0) > 0));

/**
 * As linhas do gráfico, em um lugar só.
 *
 * Além de uma linha por PDV, duas linhas que respondem perguntas que a leitura
 * caixa a caixa não responde (pedido do José em 06/10/2026):
 *  - SOMA: a loja inteira no dia. É ela que se compara com a meta.
 *  - META: a meta do dia, da matriz por dia da semana. Tracejada, porque não
 *    é movimento — é o alvo.
 *
 * A meta é da LOJA, não do caixa: uma linha só, e não a meta dividida por PDV.
 * Dividir daria um alvo que ninguém combinou com ninguém.
 */
type LinhaGrafico = { name: string; data: Array<number | null>; cor: string; tipo: 'pdv' | 'soma' | 'meta'; largura: number; traco: number };
const linhasGrafico = computed<LinhaGrafico[]>(() => {
  const porPdv: LinhaGrafico[] = (dados.value?.series ?? []).map((s) => ({
    name: s.pdv,
    data: diasComFechamento.value.map((data) => s.dias.find((dia) => dia.data === data)?.pontos ?? null),
    cor: corPdv(s.pdv), tipo: 'pdv', largura: 3, traco: 0,
  }));
  const extras: LinhaGrafico[] = [];
  // Com um PDV só, a soma seria a mesma linha desenhada duas vezes.
  if (porPdv.length > 1) {
    extras.push({
      name: NOME_SOMA,
      data: diasComFechamento.value.map((data) => {
        const valores = (dados.value?.series ?? [])
          .map((s) => s.dias.find((dia) => dia.data === data)?.pontos)
          .filter((v): v is number => v != null);
        return valores.length ? valores.reduce((soma, v) => soma + v, 0) : null;
      }),
      cor: COR_SOMA, tipo: 'soma', largura: 4, traco: 0,
    });
  }
  if (temLinhaMeta.value) {
    extras.push({
      name: NOME_META,
      data: diasComFechamento.value.map((data) => metaPorData.value.get(data) ?? null),
      cor: COR_META, tipo: 'meta', largura: 2, traco: 6,
    });
  }
  return [...porPdv, ...extras];
});
const coresGrafico = computed(() => linhasGrafico.value.map((l) => l.cor));
const seriesGrafico = computed(() => linhasGrafico.value.map(({ name, data }) => ({ name, data })));
function tooltipGerentes(serieIndex: number, pontoIndex: number): string {
  const data = diasComFechamento.value[pontoIndex];
  const linhaGrafico = linhasGrafico.value[serieIndex];
  if (!data || !linhaGrafico) return '';
  const cor = coresGrafico.value[serieIndex] ?? '#667085';
  const linha = (rotulo: string, valor: string, classe: string) =>
    `<div class="gm-hover-linha ${classe}"><span>${rotulo}</span><strong>${valor}</strong></div>`;
  const topo = (titulo: string) => `<div class="gm-hover-topo"><span class="gm-hover-ponto" style="background:${cor}"></span><strong>${escaparHtml(titulo)}</strong><span>${rotuloData(data)}</span></div>`;

  // As duas linhas sintéticas têm caixa própria: não são um caixa, e repetir o
  // bloco de fechamento nelas daria a entender que são.
  if (linhaGrafico.tipo !== 'pdv') {
    const valor = linhaGrafico.data[pontoIndex];
    if (valor == null) return '';
    const nota = linhaGrafico.tipo === 'meta'
      ? 'Meta da loja para este dia da semana, da matriz por turno.'
      : 'Soma de todos os PDVs com movimento no dia.';
    return `<div class="gm-hover">${topo(linhaGrafico.name)}
      ${linha('Pontuação', `${pontos(valor)} pts`, 'gm-hover-pontos')}
      <div class="gm-hover-nota">${nota}</div>
    </div>`;
  }

  const serie = dados.value?.series[serieIndex];
  const dia = serie?.dias.find((d) => d.data === data);
  if (!serie || !dia || dia.pontos === null) return '';
  const dinheiroRestrito = dia.faturamento === null;
  return `<div class="gm-hover">
    ${topo(serie.pdv)}
    ${dia.parcial ? '<div class="gm-hover-nota" style="margin-top:0;padding-top:0;border-top:0">Dia em curso: vem das vendas ao vivo e ainda vai subir.</div>' : ''}
    ${linha('Pontuação', `${pontos(dia.pontos)} pts`, 'gm-hover-pontos')}
    ${linha('Faturamento do fechamento', dinheiroRestrito ? 'Restrito' : moeda(dia.faturamento!), 'gm-hover-faturamento')}
    ${linha(dia.quantidade !== null && dia.vendasComItens !== dia.numeroVendas ? 'Quantidade vendida (parcial)' : 'Quantidade vendida', dia.quantidade === null ? 'Sem detalhe confiável' : quantidade(dia.quantidade), 'gm-hover-quantidade')}
    ${linha('Número de vendas', String(dia.numeroVendas ?? '—'), 'gm-hover-vendas')}
    ${linha('Ticket médio', dia.ticketMedio === null ? (dinheiroRestrito ? 'Restrito' : '—') : moeda(dia.ticketMedio), 'gm-hover-ticket')}
    ${dia.quantidade !== null ? `<div class="gm-hover-nota">Soma de itens/peso vinculados pelo ERP em ${dia.vendasComItens} de ${dia.numeroVendas} venda(s).</div>` : '<div class="gm-hover-nota">Quantidade sem vínculo confiável ao PDV neste dia.</div>'}
    <div class="gm-hover-nota">Clique no ponto para ver os produtos deste dia.</div>
  </div>`;
}
const opcoesGrafico = computed<ApexOptions>(() => ({
  chart: {
    type: 'line', height: 420, toolbar: { show: false }, zoom: { enabled: false },
    fontFamily: 'inherit', animations: { enabled: true, speed: 400 }, foreColor: '#667085',
    events: {
      // os dois, porque o alvo é pequeno: o marcador e a área do ponto
      dataPointSelection: (_e, _c, cfg: { seriesIndex: number; dataPointIndex: number }) => abrirPonto(cfg.seriesIndex, cfg.dataPointIndex),
      markerClick: (_e, _c, cfg: { seriesIndex: number; dataPointIndex: number }) => abrirPonto(cfg.seriesIndex, cfg.dataPointIndex),
    },
  },
  colors: coresGrafico.value,
  stroke: {
    curve: 'smooth', lineCap: 'round',
    width: linhasGrafico.value.map((l) => l.largura),
    dashArray: linhasGrafico.value.map((l) => l.traco),
  },
  dataLabels: { enabled: false },
  markers: { size: apenasUmDia.value ? 7 : 3, strokeWidth: 2, strokeColors: '#FFFFFF', hover: { size: 8 } },
  grid: { borderColor: '#E5E7EB', xaxis: { lines: { show: false } }, padding: { left: 12, right: 24, top: 8 } },
  xaxis: {
    categories: diasComFechamento.value.map(rotuloData),
    tickAmount: Math.min(12, diasComFechamento.value.length),
    axisBorder: { show: false }, axisTicks: { show: false },
    labels: { rotate: 0, hideOverlappingLabels: true, style: { colors: '#667085', fontSize: '12px' } },
    crosshairs: { show: true, stroke: { color: '#D0D5DD', width: 1 } },
  },
  yaxis: { min: 0, labels: { style: { colors: '#667085', fontSize: '12px' }, formatter: (v) => `${pontos(v)} pts` } },
  legend: { show: linhasGrafico.value.length > 1, position: 'bottom', fontSize: '12px' },
  tooltip: { shared: false, intersect: false, custom: ({ seriesIndex, dataPointIndex }) => tooltipGerentes(seriesIndex, dataPointIndex) },
  noData: { text: 'Sem fechamento no período' },
}));

/**
 * Os cards de meta valem para QUALQUER recorte — mês, semana ou dia.
 *
 * Antes só apareciam na semana, e no resto do tempo a tela dizia "a regra da
 * meta será definida depois", o que deixou de ser verdade quando a matriz por
 * dia da semana nasceu: ela sabe a meta de qualquer intervalo, somando os dias
 * da semana que ele contém.
 *
 * REALIZADO vem das METAS, não de `dados.totalPontos`. São contas diferentes:
 * a meta conta só `natureza = 'posto'` e o gráfico conta todo PDV com
 * movimento. Misturar as duas fazia "quanto falta" nunca fechar com o card ao
 * lado — e ninguém descobriria por quê.
 */
const temMeta = computed(() => !!metas.value?.versao);
const metaDoPeriodo = computed(() => (temMeta.value ? metas.value!.turnos.total.metaPeriodo : null));
const metaAteAgora = computed(() => (temMeta.value ? metas.value!.turnos.total.metaAteAgora : null));
const realizadoNaMeta = computed(() => (temMeta.value ? metas.value!.turnos.total.realizado : null));
/** Quanto do esperado ATÉ AGORA já entrou, em 0–100. Null sem esperado. */
const ritmoMeta = computed(() => {
  const r = metas.value?.turnos.total.ritmo;
  return r == null ? null : r * 100;
});
const metaBatida = computed(() => metaDoPeriodo.value !== null && realizadoNaMeta.value !== null
  && realizadoNaMeta.value >= metaDoPeriodo.value);
const restante = computed(() => metaDoPeriodo.value === null || realizadoNaMeta.value === null
  ? null : Math.max(0, metaDoPeriodo.value - realizadoNaMeta.value));
const excedente = computed(() => metaDoPeriodo.value === null || realizadoNaMeta.value === null
  ? null : Math.max(0, realizadoNaMeta.value - metaDoPeriodo.value));
const rotuloRecorte = computed(() => (modo.value === 'mes' ? 'no mês' : modo.value === 'semana' ? 'na semana' : 'no dia'));

/**
 * Ticket médio do recorte: faturamento ÷ número de vendas, as duas somas do
 * fechamento. Não é a média dos tickets de cada dia — dia pequeno e dia grande
 * não pesam igual, e a média de médias esconderia isso.
 */
const ticketMedioPeriodo = computed(() => {
  let faturamento = 0;
  let vendas = 0;
  let temDinheiro = false;
  for (const serie of dados.value?.series ?? []) {
    for (const dia of serie.dias) {
      if (dia.faturamento !== null) { faturamento += dia.faturamento; temDinheiro = true; }
      if (dia.numeroVendas !== null) vendas += dia.numeroVendas;
    }
  }
  if (!temDinheiro || vendas === 0) return null;
  return faturamento / vendas;
});
const numeroVendasPeriodo = computed(() => (dados.value?.series ?? [])
  .reduce((soma, serie) => soma + serie.dias.reduce((s, d) => s + (d.numeroVendas ?? 0), 0), 0));

/*
 * O ponto clicado abre a lista de produtos daquele dia. Clicar na linha de
 * meta não abre nada: meta não tem produto.
 */
const pontoAberto = ref<{ data: string; pdv: string | null; hora?: string | null } | null>(null);
function abrirPonto(serieIndex: number, pontoIndex: number) {
  const linha = linhasGrafico.value[serieIndex];
  const data = diasComFechamento.value[pontoIndex];
  if (!linha || !data || linha.tipo === 'meta') return;
  pontoAberto.value = { data, pdv: linha.tipo === 'pdv' ? linha.name : null };
}
// trocar de recorte invalida o ponto aberto: ele era de outro período
watch([loja, mes, modo, diaDigitado, semana, pdv], () => { pontoAberto.value = null; });

/*
 * AO VIVO. O dia em curso vem das vendas que o robô já capturou, e sobe
 * sozinho enquanto a loja vende. Relê só quando o recorte inclui hoje — num
 * mês fechado não há o que atualizar, e a releitura seria tráfego à toa.
 */
const AO_VIVO_SEGUNDOS = 60;
const recorteIncluiHoje = computed(() => {
  const recorte = periodo.value;
  if (!recorte) return false;
  const hoje = VendasGerentesPeriodo.hojeSaoPaulo();
  return hoje >= recorte.inicio && hoje <= recorte.fim;
});
let relogioAoVivo: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  relogioAoVivo = setInterval(() => {
    if (!recorteIncluiHoje.value || document.hidden) return;
    void carregar(true);
    void carregarMetas();
  }, AO_VIVO_SEGUNDOS * 1000);
});
onBeforeUnmount(() => { if (relogioAoVivo) clearInterval(relogioAoVivo); });
</script>

<template>
  <div class="relatorio-gerentes">
    <v-card flat class="gm-card gm-filtros mb-5">
      <div class="gm-cabecalho">
        <span class="gm-icone gm-icone--marca"><v-icon icon="query_stats" size="27" /></span>
        <div>
          <p class="gm-eyebrow">INTELIGÊNCIA DE VENDAS</p>
          <h1>Relatório Gerentes</h1>
          <p class="gm-subtitulo">Acompanhe a pontuação de cada caixa com dados dos fechamentos.</p>
        </div>
      </div>
      <div class="gm-divisoria" />
      <div class="gm-filtro-titulo"><v-icon icon="tune" size="19" /> Ajustar visualização</div>
      <div class="filtros-gerentes">
        <v-select v-if="lojasPermitidas.length > 1" v-model="loja" :items="lojasPermitidas" label="Loja" prepend-inner-icon="storefront" variant="outlined" density="comfortable" hide-details />
        <v-text-field v-else :model-value="lojasPermitidas[0] || '—'" label="Loja" prepend-inner-icon="storefront" variant="outlined" density="comfortable" hide-details readonly />
        <v-text-field v-model.number="ano" type="number" min="2000" max="2100" label="Ano" prepend-inner-icon="event" variant="outlined" density="comfortable" hide-details />
        <v-select v-model="mesNumero" :items="MESES" label="Mês" prepend-inner-icon="calendar_month" variant="outlined" density="comfortable" hide-details />
        <v-select v-if="aba === 'pdvs'" v-model="pdv" :items="opcoesPdv" label="PDV" prepend-inner-icon="point_of_sale" variant="outlined" density="comfortable" hide-details :menu-props="{ maxHeight: 320 }" />
      </div>
      <div class="gm-periodo">
        <span class="gm-periodo-label">Período</span>
        <v-btn-toggle v-model="modo" mandatory density="comfortable" class="gm-segmented" aria-label="Tipo de período">
          <v-btn value="mes" prepend-icon="date_range">Mês inteiro</v-btn>
          <v-btn value="semana" prepend-icon="view_week">Semana</v-btn>
          <v-btn value="dia" prepend-icon="today">Dia</v-btn>
        </v-btn-toggle>
      </div>
      <div v-if="modo === 'semana'" class="filtro-detalhe mt-4">
        <v-select v-model="semana" :items="opcoesSemanas" label="Semana do mês (segunda a sábado)" prepend-inner-icon="view_week" variant="outlined" density="comfortable" hide-details />
      </div>
      <div v-if="modo === 'dia'" class="filtro-detalhe mt-4">
        <v-text-field v-model.trim="diaDigitado" type="text" inputmode="numeric" maxlength="2" label="Dia do mês" prepend-inner-icon="today" variant="outlined" density="comfortable" :error-messages="erroPeriodo || undefined" hint="Digite o número do dia, sem calendário." persistent-hint />
      </div>
      <v-alert v-if="erroPeriodo && modo !== 'dia'" type="warning" variant="tonal" density="compact" class="mt-3">{{ erroPeriodo }}</v-alert>
    </v-card>

    <v-alert v-if="erroAcesso" type="error" variant="tonal" class="mb-4">{{ erroAcesso }}</v-alert>
    <v-alert v-else-if="!carregandoAcesso && !lojasPermitidas.length" type="warning" variant="tonal" class="mb-4">Esta conta não tem loja vinculada ao Relatório Gerentes.</v-alert>
    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <v-tabs v-model="aba" class="gm-abas mb-4" color="primary" aria-label="Abas do Relatório Gerentes">
      <v-tab value="pdvs" prepend-icon="show_chart">PDVs</v-tab>
      <v-tab value="areas" prepend-icon="map">Áreas da loja</v-tab>
      <v-tab value="metas" prepend-icon="flag">Metas por turno</v-tab>
    </v-tabs>

    <template v-if="aba === 'pdvs'">
    <div class="resumo-gerentes mb-4">
      <v-card flat class="gm-card gm-indicador gm-indicador--pontos">
        <div class="gm-indicador-topo"><span class="gm-icone gm-icone--pontos"><v-icon icon="monitoring" size="22" /></span><span class="gm-indicador-fonte">FECHAMENTO</span></div>
        <div class="gm-indicador-label">Pontos entregues {{ modo === 'semana' ? 'na semana' : 'no período' }}</div>
        <div class="gm-indicador-valor">{{ dados && !erroPeriodo ? `${pontos(dados.totalPontos)} pts` : '—' }}</div>
      </v-card>
      <v-card flat class="gm-card gm-indicador">
        <div class="gm-indicador-topo"><span class="gm-icone gm-icone--ticket"><v-icon icon="receipt_long" size="22" /></span><span class="gm-indicador-fonte">FECHAMENTO</span></div>
        <div class="gm-indicador-label">Ticket médio {{ rotuloRecorte }}</div>
        <div v-if="ticketMedioPeriodo === null" class="gm-indicador-placeholder">
          {{ dados && numeroVendasPeriodo ? 'Restrito' : 'Sem vendas no período' }}
        </div>
        <template v-else>
          <div class="gm-indicador-valor">{{ moeda(ticketMedioPeriodo) }}</div>
          <div class="gm-indicador-ajuda">{{ numeroVendasPeriodo.toLocaleString('pt-BR') }} venda(s)</div>
        </template>
      </v-card>
      <v-card flat class="gm-card gm-indicador">
        <div class="gm-indicador-topo"><span class="gm-icone gm-icone--meta"><v-icon icon="flag" size="22" /></span><span class="gm-indicador-fonte">MATRIZ</span></div>
        <div class="gm-indicador-label">Meta {{ rotuloRecorte }}</div>
        <template v-if="metaDoPeriodo === null">
          <div class="gm-indicador-placeholder">Sem matriz de metas</div>
          <div class="gm-indicador-ajuda">Gere a matriz na aba Metas por turno.</div>
        </template>
        <template v-else>
          <div class="gm-indicador-valor">{{ pontos(metaDoPeriodo) }} pts</div>
          <div class="gm-indicador-ajuda">Esperado até agora: {{ pontos(metaAteAgora ?? 0) }} pts</div>
        </template>
      </v-card>
      <v-card flat class="gm-card gm-indicador">
        <div class="gm-indicador-topo"><span class="gm-icone gm-icone--restante"><v-icon icon="track_changes" size="22" /></span></div>
        <div class="gm-indicador-label">Quanto falta para a meta</div>
        <template v-if="metaDoPeriodo === null">
          <div class="gm-indicador-placeholder">Sem matriz de metas</div>
        </template>
        <template v-else-if="metaBatida">
          <div class="gm-indicador-placeholder gm-sucesso"><v-icon icon="emoji_events" size="21" class="me-1" />Meta batida</div>
          <div class="gm-indicador-ajuda">{{ pontos(excedente ?? 0) }} pts acima da meta</div>
        </template>
        <template v-else>
          <div class="gm-indicador-valor">{{ pontos(restante ?? 0) }} pts</div>
          <div class="gm-indicador-ajuda">
            Entregue: {{ pontos(realizadoNaMeta ?? 0) }} pts<template v-if="ritmoMeta !== null"> · {{ pct(ritmoMeta) }} do esperado até aqui</template>
          </div>
        </template>
      </v-card>
    </div>
    <!--
      Os dois cards de meta contam só caixa de posto, que é a base da matriz;
      o card de pontos conta todo PDV com movimento. Dizer isso evita a
      pergunta "por que esses números não fecham".
    -->
    <div v-if="metaDoPeriodo !== null" class="gm-nota-meta mb-4">
      <v-icon icon="info" size="15" />
      <span>Meta e "quanto falta" usam a base da matriz (caixa de posto); o card de pontos conta todos os PDVs.</span>
    </div>

    <GerentesGraficoHorasPdv v-if="modo === 'dia' && lojasPermitidas.includes(loja)"
      :loja="loja" :data="periodo?.inicio ?? ''" :pdv="pdv === TODOS_PDV ? null : pdv"
      @pdvs="pdvsHora = $event"
      @ponto="pontoAberto = { data: periodo?.inicio ?? '', pdv: $event.pdv, hora: $event.hora }" />
    <v-card v-else flat class="gm-card gm-grafico">
      <div class="gm-grafico-cabecalho">
        <div class="gm-grafico-titulo">
          <span class="gm-icone gm-icone--grafico"><v-icon icon="show_chart" size="23" /></span>
          <div>
            <h2>Pontuação por dia e PDV</h2>
            <p>
              {{ periodo ? `${rotuloData(periodo.inicio)} a ${rotuloData(periodo.fim)}` : 'Período inválido' }} · fechamento de caixa
              <template v-if="dados?.diaAoVivo"> · {{ rotuloData(dados.diaAoVivo) }} ao vivo</template>
            </p>
          </div>
        </div>
        <div class="d-flex align-center ga-2 flex-wrap">
          <span v-if="dados?.diaAoVivo" class="gm-ao-vivo" :title="`Relê a cada ${AO_VIVO_SEGUNDOS}s`"><span class="gm-ao-vivo-ponto" />ao vivo</span>
          <span v-if="dados && temMovimento" class="gm-contagem">{{ diasComFechamento.length }} {{ diasComFechamento.length === 1 ? 'dia' : 'dias' }} com fechamento</span>
        </div>
      </div>
      <v-progress-linear v-if="carregando" indeterminate color="primary" class="mb-3" />
      <div v-if="erroPeriodo" class="estado-vazio"><v-icon icon="event_busy" size="34" />Corrija o período para ver o gráfico.</div>
      <div v-else-if="!carregando && !temMovimento" class="estado-vazio"><v-icon icon="query_stats" size="34" />Nenhum fechamento de PDV chegou neste período.</div>
      <apexchart v-else-if="dados && temMovimento" type="line" :height="420" :options="opcoesGrafico" :series="seriesGrafico" />
      <div class="gm-rodape">
        <v-icon icon="info" size="16" />
        <span>Apenas PDVs identificados e dias com fechamento entram no gráfico; dias sem dados não viram zero.
          O faturamento e o ticket vêm do fechamento, que pode incluir lançamentos além de vendas de produtos.
          A quantidade vem somente dos itens vinculados ao dispositivo pelo ERP e pode ter cobertura parcial.
          O dia em curso, quando aparece, vem das vendas ao vivo e ainda vai subir.
          <strong>Clique num ponto</strong> para ver os produtos vendidos naquele dia.</span>
      </div>
    </v-card>

    <GerentesProdutosDoPonto
      v-if="pontoAberto"
      :loja="loja" :data="pontoAberto.data" :pdv="pontoAberto.pdv" :hora="pontoAberto.hora ?? null"
      @fechar="pontoAberto = null"
    />
    </template>
    <GerentesMetasTurno
      v-else-if="aba === 'metas' && lojasPermitidas.includes(loja)"
      :loja="loja" :inicio="periodo?.inicio ?? ''" :dados="metas"
      :carregando="carregandoMetas" :falha="erroMetas" :pode-gerar="ehAdmin"
      @recarregar="carregarMetas"
    />
    <GerentesMapaAreas v-else-if="lojasPermitidas.includes(loja)" :loja="loja" :modo="modo" :inicio="periodo?.inicio ?? ''" :fim="periodo?.fim ?? ''" />
  </div>
</template>

<style scoped>
.relatorio-gerentes { max-width: 1440px; margin: 0 auto; color: var(--cx-ink); }
.gm-abas { border-bottom: 1px solid var(--cx-line); }
.gm-card { border: 1px solid var(--cx-line); border-radius: 22px; background: var(--cx-surface); box-shadow: 0 8px 28px rgba(30, 23, 55, .035); }
.gm-filtros { padding: 26px 28px 24px; }
.gm-cabecalho { display: flex; align-items: center; gap: 17px; }
.gm-cabecalho h1 { margin: 2px 0 3px; font-size: clamp(1.55rem, 2.4vw, 2rem); line-height: 1.14; letter-spacing: -.035em; font-weight: 740; }
.gm-eyebrow { margin: 0; color: var(--cx-brand-strong); font-size: .7rem; font-weight: 750; letter-spacing: .115em; }
.gm-subtitulo { margin: 0; color: var(--cx-ink-soft); font-size: .92rem; line-height: 1.45; }
.gm-icone { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 42px; height: 42px; border-radius: 13px; }
.gm-icone--marca { width: 54px; height: 54px; border-radius: 17px; color: var(--cx-brand); background: var(--cx-brand-wash); }
.gm-divisoria { height: 1px; background: var(--cx-line-soft); margin: 22px 0 19px; }
.gm-filtro-titulo { display: flex; align-items: center; gap: 8px; margin-bottom: 15px; color: var(--cx-ink); font-size: .82rem; font-weight: 700; letter-spacing: .015em; }
.gm-filtro-titulo .v-icon { color: var(--cx-brand); }
.filtros-gerentes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.filtros-gerentes :deep(.v-field), .filtro-detalhe :deep(.v-field) { border-radius: 13px; background: #fff; }
.filtros-gerentes :deep(.v-field__prepend-inner), .filtro-detalhe :deep(.v-field__prepend-inner) { color: var(--cx-ink-soft); }
.gm-periodo { display: flex; align-items: center; gap: 16px; margin-top: 18px; }
.gm-periodo-label { color: var(--cx-ink-soft); font-size: .8rem; font-weight: 650; }
.gm-segmented { padding: 4px; height: auto !important; border-radius: 13px; background: #f3f2f7; gap: 3px; }
.gm-segmented :deep(.v-btn) { border: 0 !important; min-width: 88px; border-radius: 10px !important; color: var(--cx-ink-soft); font-weight: 600; letter-spacing: 0; text-transform: none; }
.gm-segmented :deep(.v-btn--active) { background: #fff; color: var(--cx-brand-strong); box-shadow: 0 2px 7px rgba(36, 27, 70, .10); }
.gm-segmented :deep(.v-btn:focus-visible) { outline: 3px solid var(--cx-brand); outline-offset: 2px; }
.filtro-detalhe { max-width: 440px; }
/* Quatro indicadores: dois por linha no tablet, um no celular. */
.resumo-gerentes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1200px) { .resumo-gerentes { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.gm-indicador { min-height: 178px; padding: 20px 22px 21px; }
.gm-indicador--pontos { background: linear-gradient(145deg, #fff 62%, #f8f5ff); }
.gm-indicador-topo { display: flex; align-items: center; justify-content: space-between; min-height: 43px; margin-bottom: 14px; }
.gm-icone--pontos { color: var(--cx-brand); background: var(--cx-brand-wash); }
.gm-icone--meta { color: #a96f00; background: #fff5d8; }
.gm-icone--restante { color: #256b7a; background: #e8f7f8; }
.gm-icone--ticket { color: #17733c; background: #e7f6ec; }
.gm-nota-meta { display: flex; align-items: flex-start; gap: 7px; color: var(--cx-ink-soft); font-size: .75rem; line-height: 1.5; }
.gm-ao-vivo { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: #e7f6ec; color: #17733c; font-size: .72rem; font-weight: 700; }
.gm-ao-vivo-ponto { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: gm-pulso 1.6s ease-in-out infinite; }
@keyframes gm-pulso { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .gm-ao-vivo-ponto { animation: none; } }
.gm-indicador-fonte { color: var(--cx-ink-faint); font-size: .64rem; font-weight: 750; letter-spacing: .09em; }
.gm-indicador-label { color: var(--cx-ink-soft); font-size: .84rem; line-height: 1.4; }
.gm-indicador-valor { margin-top: 5px; color: var(--cx-ink); font-size: clamp(1.55rem, 2.5vw, 2rem); font-weight: 760; letter-spacing: -.035em; line-height: 1.2; font-variant-numeric: tabular-nums; }
.gm-indicador-placeholder { margin-top: 6px; font-size: 1rem; font-weight: 650; line-height: 1.4; }
.gm-indicador-ajuda { margin-top: 5px; color: var(--cx-ink-soft); font-size: .76rem; line-height: 1.35; }
.gm-sucesso { color: var(--cx-positive); }
.gm-grafico { padding: 25px 27px 22px; }
.gm-grafico-cabecalho { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 19px; }
.gm-grafico-titulo { display: flex; align-items: center; gap: 12px; }
.gm-icone--grafico { color: var(--cx-brand); background: var(--cx-brand-wash); }
.gm-grafico-titulo h2 { margin: 0; font-size: 1.15rem; font-weight: 730; letter-spacing: -.02em; line-height: 1.3; }
.gm-grafico-titulo p { margin: 3px 0 0; color: var(--cx-ink-soft); font-size: .82rem; }
.gm-contagem { border: 1px solid var(--cx-line); border-radius: 999px; padding: 7px 11px; color: var(--cx-ink-soft); background: var(--cx-surface-sunken); font-size: .72rem; font-weight: 650; white-space: nowrap; }
.gm-rodape { display: flex; align-items: flex-start; gap: 7px; padding-top: 12px; border-top: 1px solid var(--cx-line-soft); color: var(--cx-ink-soft); font-size: .75rem; line-height: 1.5; }
.gm-rodape .v-icon { flex: 0 0 auto; margin-top: 1px; }
.estado-vazio { min-height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; color: var(--cx-ink-soft); text-align: center; }
.estado-vazio .v-icon { color: var(--cx-ink-faint); }
@media (max-width: 800px) {
  .filtros-gerentes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .resumo-gerentes { grid-template-columns: 1fr; }
  .gm-indicador { min-height: 0; }
}
@media (max-width: 520px) {
  .gm-filtros, .gm-grafico { padding: 20px 17px; }
  .gm-cabecalho { align-items: flex-start; gap: 12px; }
  .gm-icone--marca { width: 45px; height: 45px; border-radius: 14px; }
  .gm-subtitulo { font-size: .84rem; }
  .filtros-gerentes { grid-template-columns: 1fr; }
  .gm-periodo { align-items: flex-start; flex-direction: column; gap: 8px; }
  .gm-segmented { width: 100%; }
  .gm-segmented :deep(.v-btn) { flex: 1; min-width: 0; padding: 0 8px; }
  .gm-grafico-cabecalho { align-items: flex-start; flex-direction: column; }
  .gm-contagem { align-self: flex-start; }
}
</style>

<style>
.gm-hover { min-width: 245px; max-width: 300px; padding: 13px 15px; border: 1px solid #e7e8ed; border-radius: 14px; background: #fff; box-shadow: 0 12px 30px rgba(25, 31, 47, .14); color: #282a32; font-family: inherit; font-size: 12px; line-height: 1.4; }
.gm-hover-topo { display: flex; align-items: center; gap: 7px; padding-bottom: 10px; margin-bottom: 7px; border-bottom: 1px solid #edf0f3; font-size: 12px; }
.gm-hover-topo strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.gm-hover-topo > span:last-child { color: #667085; white-space: nowrap; }
.gm-hover-ponto { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.gm-hover-linha { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 4px 0; }
.gm-hover-linha span { color: #667085; }
.gm-hover-linha strong { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
.gm-hover-faturamento strong, .gm-hover-vendas strong { color: #a66b00; }
.gm-hover-quantidade strong, .gm-hover-ticket strong { color: #17733c; }
.gm-hover-pontos strong { color: #6c39bd; }
.gm-hover-nota { margin-top: 7px; padding-top: 8px; border-top: 1px solid #edf0f3; color: #667085; font-size: 11px; line-height: 1.4; }
</style>
