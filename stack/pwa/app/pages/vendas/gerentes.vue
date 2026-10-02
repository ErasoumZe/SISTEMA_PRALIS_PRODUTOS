<script setup lang="ts">
import type { ApexOptions } from 'apexcharts';
import { VendasGerentesPeriodo } from '@pralis/shared';
import type { RelatorioGerentes } from '~/composables/useApi';

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
const aba = ref<'pdvs' | 'areas'>('pdvs');

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

async function carregar() {
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
  carregando.value = true;
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
    await carregar();
  } catch (e: unknown) {
    lojasPermitidas.value = [];
    dados.value = null;
    erroAcesso.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível verificar as lojas permitidas.';
  } finally { carregandoAcesso.value = false; }
}

onMounted(carregarAcesso);
watch(() => user.value?.id, carregarAcesso);
watch([loja, mes, modo, diaDigitado, semana, pdv], carregar);
watch([ano, mesNumero], () => { semana.value = 1; diaDigitado.value = ''; });
watch([loja, mes, modo, diaDigitado, semana], () => { pdv.value = TODOS_PDV; });

const opcoesPdv = computed(() => [
  { title: 'Todos os PDVs com fechamento', value: TODOS_PDV },
  ...(dados.value?.pdvs ?? []).filter((nome) => nome.trim()).map((nome) => ({ title: nome, value: nome })),
]);
const diasComFechamento = computed(() => {
  const series = dados.value?.series ?? [];
  const datas = series[0]?.dias.map((dia) => dia.data) ?? [];
  return datas.filter((data, i) => series.some((serie) => serie.dias[i]?.pontos != null && serie.dias[i]?.data === data));
});
const temMovimento = computed(() => diasComFechamento.value.length > 0);
const apenasUmDia = computed(() => diasComFechamento.value.length === 1);
const pontos = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function rotuloData(iso: string) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''; }
function escaparHtml(valor: string) {
  const entidades: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return valor.replace(/[&<>"']/g, (c) => entidades[c] ?? c);
}
// Cores categóricas vivas e estáveis ao alternar entre Todos e um PDV.
const PALETA_PDV = ['#F9AB00', '#1A73E8', '#34A853', '#EA4335', '#A142F4', '#00ACC1', '#FF6D00', '#D81B60'];
const coresGrafico = computed(() => (dados.value?.series ?? []).map((serie) => {
  const indice = dados.value?.pdvs.indexOf(serie.pdv) ?? 0;
  return PALETA_PDV[Math.max(0, indice) % PALETA_PDV.length];
}));
const seriesGrafico = computed(() => (dados.value?.series ?? []).map((s) => ({
  name: s.pdv,
  data: diasComFechamento.value.map((data) => s.dias.find((dia) => dia.data === data)?.pontos ?? null),
})));
function tooltipGerentes(serieIndex: number, pontoIndex: number): string {
  const data = diasComFechamento.value[pontoIndex];
  const serie = dados.value?.series[serieIndex];
  const dia = serie?.dias.find((d) => d.data === data);
  if (!data || !serie || !dia || dia.pontos === null) return '';
  const cor = coresGrafico.value[serieIndex] ?? '#667085';
  const linha = (rotulo: string, valor: string, classe: string) =>
    `<div class="gm-hover-linha ${classe}"><span>${rotulo}</span><strong>${valor}</strong></div>`;
  const dinheiroRestrito = dia.faturamento === null;
  return `<div class="gm-hover">
    <div class="gm-hover-topo"><span class="gm-hover-ponto" style="background:${cor}"></span><strong>${escaparHtml(serie.pdv)}</strong><span>${rotuloData(data)}</span></div>
    ${linha('Pontuação', `${pontos(dia.pontos)} pts`, 'gm-hover-pontos')}
    ${linha('Faturamento do fechamento', dinheiroRestrito ? 'Restrito' : moeda(dia.faturamento!), 'gm-hover-faturamento')}
    ${linha(dia.quantidade !== null && dia.vendasComItens !== dia.numeroVendas ? 'Quantidade vendida (parcial)' : 'Quantidade vendida', dia.quantidade === null ? 'Sem detalhe confiável' : pontos(dia.quantidade), 'gm-hover-quantidade')}
    ${linha('Número de vendas', String(dia.numeroVendas ?? '—'), 'gm-hover-vendas')}
    ${linha('Ticket médio', dia.ticketMedio === null ? (dinheiroRestrito ? 'Restrito' : '—') : moeda(dia.ticketMedio), 'gm-hover-ticket')}
    ${dia.quantidade !== null ? `<div class="gm-hover-nota">Soma de itens/peso vinculados pelo ERP em ${dia.vendasComItens} de ${dia.numeroVendas} venda(s).</div>` : '<div class="gm-hover-nota">Quantidade sem vínculo confiável ao PDV neste dia.</div>'}
  </div>`;
}
const opcoesGrafico = computed<ApexOptions>(() => ({
  chart: { type: 'line', height: 420, toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'inherit', animations: { enabled: true, speed: 400 }, foreColor: '#667085' },
  colors: coresGrafico.value,
  stroke: { curve: 'smooth', width: 3, lineCap: 'round' },
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
  legend: { show: (dados.value?.series.length ?? 0) > 1, position: 'bottom', fontSize: '12px' },
  tooltip: { shared: false, intersect: false, custom: ({ seriesIndex, dataPointIndex }) => tooltipGerentes(seriesIndex, dataPointIndex) },
  noData: { text: 'Sem fechamento no período' },
}));

// A fonte da meta ainda não existe. Não criar número fictício nem mostrar troféu.
const metaSemanalPontos = ref<number | null>(null);
const entregueNaSemana = computed(() => modo.value === 'semana' ? dados.value?.totalPontos ?? null : null);
const restante = computed(() => metaSemanalPontos.value === null || entregueNaSemana.value === null
  ? null : Math.max(0, metaSemanalPontos.value - entregueNaSemana.value));
const excedente = computed(() => metaSemanalPontos.value === null || entregueNaSemana.value === null
  ? null : Math.max(0, entregueNaSemana.value - metaSemanalPontos.value));
const metaBatida = computed(() => metaSemanalPontos.value !== null && entregueNaSemana.value !== null
  && entregueNaSemana.value >= metaSemanalPontos.value);
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
    </v-tabs>

    <template v-if="aba === 'pdvs'">
    <div class="resumo-gerentes mb-4">
      <v-card flat class="gm-card gm-indicador gm-indicador--pontos">
        <div class="gm-indicador-topo"><span class="gm-icone gm-icone--pontos"><v-icon icon="monitoring" size="22" /></span><span class="gm-indicador-fonte">FECHAMENTO</span></div>
        <div class="gm-indicador-label">Pontos entregues {{ modo === 'semana' ? 'na semana' : 'no período' }}</div>
        <div class="gm-indicador-valor">{{ dados && !erroPeriodo ? `${pontos(dados.totalPontos)} pts` : '—' }}</div>
      </v-card>
      <v-card flat class="gm-card gm-indicador">
        <div class="gm-indicador-topo"><span class="gm-icone gm-icone--meta"><v-icon icon="flag" size="22" /></span></div>
        <div class="gm-indicador-label">Meta semanal</div>
        <template v-if="metaSemanalPontos === null">
          <div class="gm-indicador-placeholder">Ainda não configurada</div>
          <div class="gm-indicador-ajuda">A regra da meta será definida depois.</div>
        </template>
        <div v-else class="gm-indicador-valor">{{ pontos(metaSemanalPontos) }} pts</div>
      </v-card>
      <v-card flat class="gm-card gm-indicador">
        <div class="gm-indicador-topo"><span class="gm-icone gm-icone--restante"><v-icon icon="track_changes" size="22" /></span></div>
        <div class="gm-indicador-label">Quanto falta para a meta semanal</div>
        <div v-if="metaSemanalPontos === null" class="gm-indicador-placeholder">Aguardando definição da meta</div>
        <div v-else-if="modo !== 'semana'" class="gm-indicador-placeholder">Selecione uma semana</div>
        <template v-else-if="metaBatida">
          <div class="gm-indicador-placeholder gm-sucesso"><v-icon icon="emoji_events" size="21" class="me-1" />Meta batida</div>
          <div class="gm-indicador-ajuda">{{ pontos(excedente ?? 0) }} pts acima da meta</div>
        </template>
        <div v-else class="gm-indicador-valor">{{ pontos(restante ?? 0) }} pts</div>
      </v-card>
    </div>

    <v-card flat class="gm-card gm-grafico">
      <div class="gm-grafico-cabecalho">
        <div class="gm-grafico-titulo">
          <span class="gm-icone gm-icone--grafico"><v-icon icon="show_chart" size="23" /></span>
          <div>
            <h2>Pontuação por dia e PDV</h2>
            <p>{{ periodo ? `${rotuloData(periodo.inicio)} a ${rotuloData(periodo.fim)}` : 'Período inválido' }} · fechamento de caixa</p>
          </div>
        </div>
        <span v-if="dados && temMovimento" class="gm-contagem">{{ diasComFechamento.length }} {{ diasComFechamento.length === 1 ? 'dia' : 'dias' }} com fechamento</span>
      </div>
      <v-progress-linear v-if="carregando" indeterminate color="primary" class="mb-3" />
      <div v-if="erroPeriodo" class="estado-vazio"><v-icon icon="event_busy" size="34" />Corrija o período para ver o gráfico.</div>
      <div v-else-if="!carregando && !temMovimento" class="estado-vazio"><v-icon icon="query_stats" size="34" />Nenhum fechamento de PDV chegou neste período.</div>
      <apexchart v-else-if="dados && temMovimento" type="line" :height="420" :options="opcoesGrafico" :series="seriesGrafico" />
      <div class="gm-rodape">
        <v-icon icon="info" size="16" />
        <span>Apenas PDVs identificados e dias com fechamento entram no gráfico; dias sem dados não viram zero.
          O faturamento e o ticket vêm do fechamento, que pode incluir lançamentos além de vendas de produtos.
          A quantidade vem somente dos itens vinculados ao dispositivo pelo ERP e pode ter cobertura parcial.</span>
      </div>
    </v-card>
    </template>
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
.resumo-gerentes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.gm-indicador { min-height: 178px; padding: 20px 22px 21px; }
.gm-indicador--pontos { background: linear-gradient(145deg, #fff 62%, #f8f5ff); }
.gm-indicador-topo { display: flex; align-items: center; justify-content: space-between; min-height: 43px; margin-bottom: 14px; }
.gm-icone--pontos { color: var(--cx-brand); background: var(--cx-brand-wash); }
.gm-icone--meta { color: #a96f00; background: #fff5d8; }
.gm-icone--restante { color: #256b7a; background: #e8f7f8; }
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
