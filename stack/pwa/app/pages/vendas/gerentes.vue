<script setup lang="ts">
import type { ApexOptions } from 'apexcharts';
import { VendasGerentesPeriodo } from '@pralis/shared';
import type { RelatorioGerentes } from '~/composables/useApi';

definePageMeta({ layout: 'default' });

const api = useApi();
const { user } = useAuth();
const admin = computed(() => user.value?.role === 'admin');
const loja = ref<'TNP' | 'LI'>(user.value?.loja === 'LI' ? 'LI' : 'TNP');
const mesAtual = VendasGerentesPeriodo.mesAtualSaoPaulo();
const ano = ref(Number(mesAtual.slice(0, 4)));
const mesNumero = ref(Number(mesAtual.slice(5, 7)));
const modo = ref<VendasGerentesPeriodo.ModoGerentes>('mes');
const diaDigitado = ref('');
const semana = ref(1);
const pdv = ref<string | null>(null);

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
      ...(admin.value ? { loja: loja.value } : {}),
      ...recorte,
      ...(pdv.value ? { pdv: pdv.value } : {}),
    });
    if (atual === requisicao) dados.value = resposta;
  } catch (e: unknown) {
    if (atual === requisicao) {
      dados.value = null;
      erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar os pontos.';
    }
  } finally { if (atual === requisicao) carregando.value = false; }
}

onMounted(carregar);
watch([loja, mes, modo, diaDigitado, semana, pdv, () => user.value?.role, () => user.value?.loja], carregar);
watch([ano, mesNumero], () => { semana.value = 1; diaDigitado.value = ''; });
watch(loja, () => { pdv.value = null; });

const opcoesPdv = computed(() => [
  { title: 'Todos os PDVs', value: null },
  ...(dados.value?.pdvs ?? []).map((nome) => ({ title: nome, value: nome })),
]);
const temMovimento = computed(() => dados.value?.series.some((s) => s.dias.some((d) => d.pontos !== null)) ?? false);
const pontos = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function rotuloData(iso: string) { return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`; }
// Matiz única por PDV, estável entre "Todos" e a visualização individual.
const coresGrafico = computed(() => (dados.value?.series ?? []).map((serie) => {
  const indice = dados.value?.pdvs.indexOf(serie.pdv) ?? 0;
  return `hsl(${Math.round((266 + indice * 137.508) % 360)} 68% 40%)`;
}));
const seriesGrafico = computed(() => (dados.value?.series ?? []).map((s) => ({
  name: s.pdv, data: s.dias.map((d) => d.pontos),
})));
const opcoesGrafico = computed<ApexOptions>(() => ({
  chart: { type: 'line', height: 420, toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'inherit' },
  colors: coresGrafico.value,
  stroke: { curve: 'smooth', width: 3, lineCap: 'round' },
  dataLabels: { enabled: false },
  markers: { size: modo.value === 'dia' ? 6 : 3, hover: { size: 8 } },
  grid: { borderColor: '#E5E7EB', padding: { left: 8, right: 16 } },
  xaxis: {
    categories: dados.value?.series[0]?.dias.map((d) => rotuloData(d.data)) ?? [],
    tickAmount: Math.min(12, dados.value?.series[0]?.dias.length ?? 0),
    labels: { rotate: 0, hideOverlappingLabels: true },
  },
  yaxis: { min: 0, labels: { formatter: (v) => `${pontos(v)} pts` } },
  legend: { show: true, position: 'bottom' },
  tooltip: { shared: true, intersect: false, y: { formatter: (v) => v == null ? 'Sem fechamento' : `${pontos(v)} pontos` } },
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
    <v-card flat border rounded="lg" class="pa-4 pa-md-5 mb-4">
      <div class="text-h6 font-weight-bold mb-1">Relatório Gerentes</div>
      <div class="text-body-2 text-medium-emphasis mb-4">Pontuação por PDV, com base no fechamento diário do caixa.</div>
      <div class="filtros-gerentes">
        <v-select v-if="admin" v-model="loja" :items="['TNP', 'LI']" label="Loja" variant="outlined" density="comfortable" hide-details />
        <v-text-field v-model.number="ano" type="number" min="2000" max="2100" label="Ano" variant="outlined" density="comfortable" hide-details />
        <v-select v-model="mesNumero" :items="MESES" label="Mês" variant="outlined" density="comfortable" hide-details />
        <v-select v-model="pdv" :items="opcoesPdv" label="PDV" variant="outlined" density="comfortable" hide-details />
      </div>
      <v-btn-toggle v-model="modo" mandatory variant="outlined" divided density="comfortable" class="mt-4" aria-label="Tipo de período">
        <v-btn value="mes">Mês inteiro</v-btn>
        <v-btn value="semana">Semana</v-btn>
        <v-btn value="dia">Dia</v-btn>
      </v-btn-toggle>
      <div v-if="modo === 'semana'" class="filtro-detalhe mt-4">
        <v-select v-model="semana" :items="opcoesSemanas" label="Semana do mês (segunda a sábado)" variant="outlined" density="comfortable" hide-details />
      </div>
      <div v-if="modo === 'dia'" class="filtro-detalhe mt-4">
        <v-text-field v-model.trim="diaDigitado" type="text" inputmode="numeric" maxlength="2" label="Dia do mês" variant="outlined" density="comfortable" :error-messages="erroPeriodo || undefined" hint="Digite o número do dia, sem calendário." persistent-hint />
      </div>
      <v-alert v-if="erroPeriodo && modo !== 'dia'" type="warning" variant="tonal" density="compact" class="mt-3">{{ erroPeriodo }}</v-alert>
    </v-card>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <div class="resumo-gerentes mb-4">
      <v-card flat border rounded="lg" class="pa-4">
        <div class="text-body-2 text-medium-emphasis">Pontos entregues {{ modo === 'semana' ? 'na semana' : 'no período' }}</div>
        <div class="text-h5 font-weight-bold">{{ dados && !erroPeriodo ? `${pontos(dados.totalPontos)} pts` : '—' }}</div>
      </v-card>
      <v-card flat border rounded="lg" class="pa-4">
        <div class="text-body-2 text-medium-emphasis">Meta semanal</div>
        <template v-if="metaSemanalPontos === null">
          <div class="text-subtitle-1 font-weight-medium">Ainda não configurada</div>
          <div class="text-caption text-medium-emphasis">A origem e a regra da meta serão definidas depois.</div>
        </template>
        <div v-else class="text-h5 font-weight-bold">{{ pontos(metaSemanalPontos) }} pts</div>
      </v-card>
      <v-card flat border rounded="lg" class="pa-4">
        <div class="text-body-2 text-medium-emphasis">Quanto falta para a meta semanal</div>
        <div v-if="metaSemanalPontos === null" class="text-subtitle-1 font-weight-medium">Aguardando definição da meta</div>
        <div v-else-if="modo !== 'semana'" class="text-subtitle-1">Selecione uma semana para acompanhar.</div>
        <template v-else-if="metaBatida">
          <div class="text-h6"><v-icon icon="emoji_events" color="amber-darken-3" class="me-2" />Meta batida</div>
          <div class="text-body-2">{{ pontos(excedente ?? 0) }} pts acima da meta</div>
        </template>
        <div v-else class="text-h6">{{ pontos(restante ?? 0) }} pts</div>
      </v-card>
    </div>

    <v-card flat border rounded="lg" class="pa-4 pa-md-5">
      <div class="text-h6 font-weight-bold">Pontuação por dia e PDV</div>
      <div class="text-body-2 text-medium-emphasis mb-4">
        {{ periodo ? `${rotuloData(periodo.inicio)} a ${rotuloData(periodo.fim)}` : 'Período inválido' }} · fechamento de caixa · dados diários
      </div>
      <v-progress-linear v-if="carregando" indeterminate color="primary" class="mb-3" />
      <div v-if="erroPeriodo" class="estado-vazio">Corrija o período para ver o gráfico.</div>
      <div v-else-if="!carregando && !temMovimento" class="estado-vazio">Nenhum fechamento de PDV chegou neste período.</div>
      <apexchart v-else-if="dados && temMovimento" type="line" :height="420" :options="opcoesGrafico" :series="seriesGrafico" />
      <div class="text-caption text-medium-emphasis mt-3">
        Um ponto por dia, sem dados por hora. Dias sem fechamento aparecem como lacunas, não como zero.
        A pontuação segue a regra vigente do ranking; o fechamento pode conter lançamentos além de vendas de produtos.
      </div>
    </v-card>
  </div>
</template>

<style scoped>
.relatorio-gerentes { max-width: 1440px; margin: 0 auto; }
.filtros-gerentes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.filtro-detalhe { max-width: 440px; }
.resumo-gerentes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.estado-vazio { min-height: 280px; display: grid; place-items: center; color: #64748b; text-align: center; }
@media (max-width: 800px) {
  .filtros-gerentes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .resumo-gerentes { grid-template-columns: 1fr; }
}
@media (max-width: 520px) { .filtros-gerentes { grid-template-columns: 1fr; } }
</style>
