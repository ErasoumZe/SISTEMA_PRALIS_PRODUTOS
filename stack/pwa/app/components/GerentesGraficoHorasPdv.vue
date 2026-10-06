<script setup lang="ts">
import { VendasFormato } from '@pralis/shared';
import type { ApexOptions } from 'apexcharts';
import type { RelatorioGerentesHoras } from '~/composables/useApi';
import { corPdv } from '~/utils/gerentesCores';

const props = defineProps<{ loja: 'TNP' | 'LI'; data: string; pdv: string | null }>();
const emit = defineEmits<{
  pdvs: [nomes: string[]];
  /** Ponto clicado: a hora cheia ('14') e o PDV daquela linha. */
  ponto: [valor: { hora: string; pdv: string }];
}>();
const api = useApi();
const dados = ref<RelatorioGerentesHoras | null>(null);
const carregando = ref(false);
const erro = ref('');
let requisicao = 0;
async function carregar() {
  const atual = ++requisicao;
  if (!props.data) { dados.value = null; emit('pdvs', []); return; }
  carregando.value = true;
  erro.value = '';
  try {
    const resposta = await api.relatorioGerentesHoras({ loja: props.loja, data: props.data, ...(props.pdv ? { pdv: props.pdv } : {}) });
    if (atual === requisicao) { dados.value = resposta; emit('pdvs', resposta.pdvs); }
  } catch (e: unknown) {
    if (atual === requisicao) {
      dados.value = null;
      erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar as vendas por hora.';
    }
  } finally { if (atual === requisicao) carregando.value = false; }
}
onMounted(carregar);
watch(() => [props.loja, props.data, props.pdv], carregar);

const cores = computed(() => (dados.value?.series ?? []).map((serie) => corPdv(serie.pdv)));
const series = computed(() => (dados.value?.series ?? []).map((s) => ({
  name: s.pdv,
  data: (dados.value?.horas ?? []).map((hora) => s.horas.find((p) => p.hora === hora)?.pontos ?? null),
})));
const pontos = (n: number) => VendasFormato.formatarPontos(n);
const quantidade = (n: number) => VendasFormato.formatarQuantidade(n);
const moeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
function tooltip(serieIndex: number, pontoIndex: number): string {
  const serie = dados.value?.series[serieIndex];
  const hora = dados.value?.horas[pontoIndex];
  const ponto = serie?.horas.find((p) => p.hora === hora);
  if (!serie || !ponto || !hora) return '';
  const linha = (nome: string, valor: string) => `<div class="gh-hover-linha"><span>${nome}</span><strong>${valor}</strong></div>`;
  return `<div class="gh-hover"><div class="gh-hover-topo"><strong>${escapar(serie.pdv)}</strong><span>${hora}</span></div>
    ${linha('Pontuação', `${pontos(ponto.pontos)} pts`)}
    ${linha('Faturamento dos itens', ponto.faturamento === null ? 'Restrito' : moeda(ponto.faturamento))}
    ${linha('Quantidade vendida', quantidade(ponto.quantidade))}
    ${linha('Número de vendas', String(ponto.numeroVendas))}
    ${linha('Ticket médio dos itens', ponto.ticketMedio === null ? 'Restrito' : moeda(ponto.ticketMedio))}
  </div>`;
}
/** Clicar numa hora abre a lista de produtos daquela hora naquele caixa. */
function abrirPonto(serieIndex: number, pontoIndex: number) {
  const serie = dados.value?.series[serieIndex];
  const hora = serie?.horas[pontoIndex]?.hora;
  if (!serie || !hora) return;
  emit('ponto', { hora: hora.replace(/\D/g, ''), pdv: serie.pdv });
}

const opcoes = computed<ApexOptions>(() => ({
  chart: {
    type: 'line', toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'inherit', foreColor: '#667085',
    events: {
      dataPointSelection: (_e, _c, cfg: { seriesIndex: number; dataPointIndex: number }) => abrirPonto(cfg.seriesIndex, cfg.dataPointIndex),
      markerClick: (_e, _c, cfg: { seriesIndex: number; dataPointIndex: number }) => abrirPonto(cfg.seriesIndex, cfg.dataPointIndex),
    },
  },
  colors: cores.value, stroke: { curve: 'smooth', width: 3 },
  markers: { size: 4, hover: { size: 7 } }, dataLabels: { enabled: false },
  grid: { borderColor: '#E5E7EB', padding: { left: 10, right: 20 } },
  xaxis: { categories: dados.value?.horas ?? [], labels: { rotate: 0, hideOverlappingLabels: true } },
  yaxis: { min: 0, labels: { formatter: (v) => `${pontos(v)} pts` } },
  legend: { show: (dados.value?.series.length ?? 0) > 1, position: 'bottom' },
  tooltip: { shared: false, intersect: false, custom: ({ seriesIndex, dataPointIndex }) => tooltip(seriesIndex, dataPointIndex) },
}));
</script>

<template>
  <v-card flat class="gh-card">
    <div class="gh-heading">
      <span class="gh-icon"><v-icon icon="schedule" size="23" /></span>
      <div><h2>Pontuação por hora e PDV</h2><p>{{ data ? `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}` : 'Selecione um dia' }} · itens dos cupons recebidos</p></div>
    </div>
    <v-progress-linear v-if="carregando" indeterminate color="primary" class="mb-3" />
    <v-alert v-if="erro" type="error" variant="tonal">{{ erro }}</v-alert>
    <div v-else-if="!carregando && !dados?.series.length" class="gh-vazio">Nenhum item de cupom confirmado chegou para este dia e PDV. O robô de importação precisa enviar o detalhe dos cupons para habilitar o gráfico por hora.</div>
    <apexchart v-else-if="dados" type="line" :height="420" :options="opcoes" :series="series" />
    <p v-if="dados" class="gh-resumo">{{ pontos(dados.totalPontos) }} pts entre 06h e 22h<span v-if="dados.pontosForaHorario"> · {{ pontos(dados.pontosForaHorario) }} pts fora desse horário</span>.</p>
    <p class="gh-nota"><v-icon icon="info" size="16" /> <strong>Clique num ponto</strong> para ver os produtos daquela hora. Neste recorte, a fonte são itens dos cupons com horário registrado pelo ERP, não o fechamento diário. A cobertura pode ser parcial e os totais podem diferir dos pontos do fechamento mostrados acima. Horas sem itens recebidos não são tratadas como zero.</p>
  </v-card>
</template>

<style scoped>
.gh-card { padding: 25px 27px 22px; border: 1px solid var(--cx-line); border-radius: 22px; background: var(--cx-surface); }
.gh-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.gh-heading h2 { margin: 0; font-size: 1.15rem; }
.gh-heading p { margin: 3px 0 0; color: var(--cx-ink-soft); font-size: .82rem; }
.gh-icon { display: grid; place-items: center; flex: 0 0 42px; height: 42px; border-radius: 13px; color: var(--cx-brand); background: var(--cx-brand-wash); }
.gh-vazio { min-height: 300px; display: grid; place-items: center; color: var(--cx-ink-soft); text-align: center; }
.gh-resumo { margin: 0 0 12px; font-size: .82rem; font-weight: 700; }
.gh-nota { display: flex; gap: 7px; margin: 0; padding-top: 12px; border-top: 1px solid var(--cx-line-soft); color: var(--cx-ink-soft); font-size: .75rem; line-height: 1.5; }
@media (max-width: 520px) { .gh-card { padding: 20px 17px; } }
</style>
<style>
.gh-hover { min-width: 245px; padding: 13px 15px; border: 1px solid #e7e8ed; border-radius: 14px; background: #fff; box-shadow: 0 12px 30px rgba(25,31,47,.14); color: #282a32; font-family: inherit; font-size: 12px; line-height: 1.4; }
.gh-hover-topo, .gh-hover-linha { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; }
.gh-hover-topo { border-bottom: 1px solid #edf0f3; margin-bottom: 5px; }
.gh-hover-linha span { color: #667085; }
</style>
