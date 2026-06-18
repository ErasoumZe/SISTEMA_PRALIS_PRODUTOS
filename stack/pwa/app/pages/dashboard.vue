<script setup lang="ts">
import type { ApexOptions } from 'apexcharts';
import type { AdminSchemas } from '@pralis/shared';

const api = useApi();
const data = ref<AdminSchemas.Dashboard | null>(null);
const loading = ref(true);
const erro = ref('');

async function load() {
  loading.value = true;
  erro.value = '';
  try {
    data.value = await api.dashboard();
  } catch {
    erro.value = 'Não foi possível carregar o painel.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const nf = (n: number) => n.toLocaleString('pt-BR');
const pct = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : 0);

const cards = computed(() => {
  const t = data.value?.totais;
  if (!t) return [];
  return [
    { label: 'Usuários', value: t.usuarios, icon: 'mdi-account-group', color: '#6366f1' },
    { label: 'Lojas ativas', value: t.lojas, icon: 'mdi-store', color: '#10b981' },
    { label: 'Produtos (total)', value: t.produtos, icon: 'mdi-package-variant-closed', color: '#3b82f6', hint: `${nf(t.base)} no catálogo Base` },
    { label: 'Ativos', value: t.ativos, icon: 'mdi-check-circle', color: '#22c55e', hint: `${pct(t.ativos, t.produtos)}% do total` },
    { label: 'Inativos', value: t.inativos, icon: 'mdi-close-circle', color: '#ef4444', hint: `${pct(t.inativos, t.produtos)}% do total` },
  ];
});

// ---- gráficos ----
const donut = computed(() => ({
  series: [data.value?.totais.ativos ?? 0, data.value?.totais.inativos ?? 0],
  options: {
    labels: ['Ativos', 'Inativos'],
    colors: ['#22c55e', '#ef4444'],
    legend: { position: 'bottom' },
    dataLabels: { enabled: false },
    plotOptions: { pie: { donut: { size: '68%' } } },
    stroke: { width: 0 },
  } as ApexOptions,
}));

const produtividade = computed(() => {
  const p = data.value?.produtividade ?? [];
  return {
    series: [{ name: 'Produtos cadastrados', data: p.map((x) => x.total) }],
    options: {
      chart: { toolbar: { show: false } },
      colors: ['#7c3aed'],
      plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: '60%' } },
      dataLabels: { enabled: true },
      xaxis: { categories: p.map((x) => x.nome) },
      grid: { borderColor: '#eef2f7' },
    } as ApexOptions,
  };
});

const porDia = computed(() => {
  const d = data.value?.porDia ?? [];
  return {
    series: [{ name: 'Cadastros', data: d.map((x) => x.total) }],
    options: {
      chart: { toolbar: { show: false } },
      colors: ['#3b82f6'],
      stroke: { curve: 'smooth', width: 3 },
      fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0.05 } },
      dataLabels: { enabled: false },
      xaxis: { categories: d.map((x) => x.dia.slice(5)) },
      grid: { borderColor: '#eef2f7' },
    } as ApexOptions,
  };
});

const porLoja = computed(() => (data.value?.porLoja ?? []).filter((l) => l.loja !== 'BASE'));
const temProdutividade = computed(() => (data.value?.produtividade.length ?? 0) > 0);
const temDias = computed(() => (data.value?.porDia.length ?? 0) > 0);

function quando(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const lojaColor: Record<string, string> = { TNP: 'primary', LI: 'teal', HORA: 'orange', BASE: 'deep-purple' };
</script>

<template>
  <div>
    <div class="d-flex align-center mb-5">
      <div class="text-body-2 text-medium-emphasis">Métricas calculadas em tempo real a partir dos cadastros.</div>
      <v-spacer />
      <v-btn variant="tonal" color="primary" prepend-icon="mdi-refresh" :loading="loading" @click="load">Atualizar</v-btn>
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
    <v-progress-linear v-if="loading && !data" indeterminate color="primary" class="mb-4" />

    <template v-if="data">
      <!-- cards de resumo -->
      <v-row class="mb-1">
        <v-col v-for="c in cards" :key="c.label" cols="12" sm="6" md="auto" class="flex-grow-1">
          <v-card flat border rounded="lg" class="pa-4 h-100">
            <div class="d-flex align-center ga-3">
              <v-avatar :color="c.color" size="46" rounded="lg" variant="flat">
                <v-icon color="white">{{ c.icon }}</v-icon>
              </v-avatar>
              <div>
                <div class="text-caption text-medium-emphasis text-uppercase">{{ c.label }}</div>
                <div class="text-h5 font-weight-bold">{{ nf(c.value) }}</div>
                <div v-if="c.hint" class="text-caption text-medium-emphasis">{{ c.hint }}</div>
              </div>
            </div>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <!-- produtividade -->
        <v-col cols="12" md="8">
          <v-card flat border rounded="lg" class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-1">Produtividade por usuário</div>
            <div class="text-caption text-medium-emphasis mb-2">Produtos cadastrados nas lojas (exclui o catálogo Base)</div>
            <client-only>
              <apexchart v-if="temProdutividade" type="bar" height="320" :options="produtividade.options" :series="produtividade.series" />
            </client-only>
            <div v-if="!temProdutividade" class="text-center text-medium-emphasis py-10">
              <v-icon size="40" class="mb-2">mdi-chart-bar</v-icon>
              <div>Ainda não há produtos cadastrados nas lojas.</div>
            </div>
          </v-card>
        </v-col>

        <!-- donut ativos/inativos -->
        <v-col cols="12" md="4">
          <v-card flat border rounded="lg" class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-1">Resumo de cadastros</div>
            <div class="text-caption text-medium-emphasis mb-2">Ativos x Inativos</div>
            <client-only>
              <apexchart type="donut" height="280" :options="donut.options" :series="donut.series" />
            </client-only>
          </v-card>
        </v-col>

        <!-- cadastros por dia -->
        <v-col cols="12" md="8">
          <v-card flat border rounded="lg" class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-1">Cadastros por dia</div>
            <div class="text-caption text-medium-emphasis mb-2">Últimos 30 dias (lojas)</div>
            <client-only>
              <apexchart v-if="temDias" type="area" height="280" :options="porDia.options" :series="porDia.series" />
            </client-only>
            <div v-if="!temDias" class="text-center text-medium-emphasis py-10">
              <v-icon size="40" class="mb-2">mdi-chart-line</v-icon>
              <div>Sem cadastros nos últimos 30 dias.</div>
            </div>
          </v-card>
        </v-col>

        <!-- por loja + recentes -->
        <v-col cols="12" md="4">
          <v-card flat border rounded="lg" class="pa-4 mb-4">
            <div class="text-subtitle-1 font-weight-bold mb-3">Produtos por loja</div>
            <div v-for="l in porLoja" :key="l.loja" class="d-flex align-center justify-space-between mb-2">
              <v-chip :color="lojaColor[l.loja]" size="small" label>{{ l.loja }}</v-chip>
              <span class="font-weight-bold">{{ nf(l.total) }}</span>
            </div>
            <div v-if="!porLoja.length" class="text-caption text-medium-emphasis">Nenhuma loja com produtos ainda.</div>
          </v-card>

          <v-card flat border rounded="lg" class="pa-4">
            <div class="text-subtitle-1 font-weight-bold mb-3">Atividades recentes</div>
            <div v-for="(r, i) in data.recentes" :key="i" class="d-flex align-center ga-3 mb-3">
              <v-avatar color="grey-lighten-3" size="34" rounded="lg"><v-icon size="18" color="grey-darken-1">mdi-package-variant-closed</v-icon></v-avatar>
              <div style="min-width: 0">
                <div class="text-body-2 font-weight-medium text-truncate">{{ r.nome }}</div>
                <div class="text-caption text-medium-emphasis">{{ r.createdByName || '—' }} · {{ r.loja }} · {{ quando(r.createdAt) }}</div>
              </div>
            </div>
            <div v-if="!data.recentes.length" class="text-caption text-medium-emphasis">Nenhuma atividade recente.</div>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </div>
</template>
