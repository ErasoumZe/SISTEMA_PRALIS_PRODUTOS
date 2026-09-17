<script setup lang="ts">
import type { ApexOptions } from 'apexcharts';
import type { AdminSchemas } from '@pralis/shared';

const api = useApi();
const data = ref<AdminSchemas.Dashboard | null>(null);
const loading = ref(true);
const erro = ref('');
const atualizadoEm = ref<Date | null>(null);

async function load() {
  loading.value = true;
  erro.value = '';
  try {
    data.value = await api.dashboard();
    atualizadoEm.value = new Date();
  } catch {
    erro.value = 'Não foi possível carregar o painel.';
  } finally {
    loading.value = false;
  }
}
let atualizacaoAutomatica: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  atualizacaoAutomatica = setInterval(() => void load(), 30_000);
});
onBeforeUnmount(() => {
  if (atualizacaoAutomatica) clearInterval(atualizacaoAutomatica);
});

const nf = (n: number) => n.toLocaleString('pt-BR');
const pct = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : 0);

const cards = computed(() => {
  const t = data.value?.totais;
  if (!t) return [];
  // `atalho:` leva à tela que detalha o número do card. Card sem atalho não
  // vira link — melhor não clicável do que clicável sem destino útil.
  return [
    { label: 'Cadastrados hoje', value: t.cadastradosHoje, icon: 'today', color: '#F59E0B', hint: 'Desde 00:00 (horário de Brasília)' },
    { label: 'Usuários', value: t.usuarios, icon: 'group', color: '#6515DD', atalho: '/usuarios' },
    { label: 'Lojas ativas', value: t.lojas, icon: 'storefront', color: '#35128C' },
    { label: 'Produtos (total)', value: t.produtos, icon: 'inventory_2', color: '#3B82F6', hint: `${nf(t.base)} no catálogo Base`, atalho: '/' },
    { label: 'Ativos', value: t.ativos, icon: 'check_circle', color: '#34A853', hint: `${pct(t.ativos, t.produtos)}% do total`, atalho: '/?status=ativo' },
    { label: 'Inativos', value: t.inativos, icon: 'cancel', color: '#E5484D', hint: `${pct(t.inativos, t.produtos)}% do total`, atalho: '/?status=inativo' },
  ];
});

// ---- gráficos ----
const donut = computed(() => ({
  series: [data.value?.totais.ativos ?? 0, data.value?.totais.inativos ?? 0],
  options: {
    labels: ['Ativos', 'Inativos'],
    colors: ['#34A853', '#E5484D'],
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
      chart: { toolbar: { show: false }, fontFamily: 'Noto Sans, sans-serif' },
      colors: ['#6515DD'],
      plotOptions: { bar: { horizontal: true, borderRadius: 6, barHeight: '58%' } },
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
      chart: { toolbar: { show: false }, fontFamily: 'Noto Sans, sans-serif' },
      colors: ['#35128C'],
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
const lojaColor: Record<string, string> = { TNP: 'primary', LI: 'teal', HORA: 'secondary', BASE: 'primary' };
</script>

<template>
  <div>
    <div class="d-flex align-center mb-5">
      <div class="text-body-2 text-medium-emphasis">
        Métricas calculadas em tempo real a partir dos cadastros.
        <span v-if="atualizadoEm">Atualizado às {{ atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}.</span>
      </div>
      <v-spacer />
      <v-btn variant="tonal" color="primary" prepend-icon="refresh" :loading="loading" @click="load">Atualizar</v-btn>
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
    <v-progress-linear v-if="loading && !data" indeterminate color="primary" class="mb-4" />

    <template v-if="data">
      <!-- cards de resumo -->
      <v-row class="mb-1">
        <v-col v-for="c in cards" :key="c.label" cols="12" sm="6" md="auto" class="flex-grow-1">
          <v-card
            flat
            border
            rounded="lg"
            class="pa-4 h-100"
            :to="c.atalho"
            :hover="!!c.atalho"
            :ripple="!!c.atalho"
          >
            <div class="d-flex align-center ga-3">
              <v-avatar :color="c.color" size="46" rounded="lg" variant="flat">
                <v-icon color="white">{{ c.icon }}</v-icon>
              </v-avatar>
              <div style="min-width: 0">
                <div class="text-caption text-medium-emphasis text-uppercase">{{ c.label }}</div>
                <div class="text-h5 font-weight-bold">{{ nf(c.value) }}</div>
                <div v-if="c.hint" class="text-caption text-medium-emphasis">{{ c.hint }}</div>
              </div>
              <v-icon v-if="c.atalho" class="ms-auto text-medium-emphasis" size="18">chevron_right</v-icon>
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
              <v-icon size="40" class="mb-2">bar_chart</v-icon>
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
              <v-icon size="40" class="mb-2">monitoring</v-icon>
              <div>Sem cadastros nos últimos 30 dias.</div>
            </div>
          </v-card>
        </v-col>

        <!-- por loja + recentes -->
        <v-col cols="12" md="4">
          <v-card flat border rounded="lg" class="pa-4 mb-4">
            <div class="text-subtitle-1 font-weight-bold mb-3">Produtos por loja</div>
            <NuxtLink
              v-for="l in porLoja"
              :key="l.loja"
              :to="`/?loja=${l.loja}`"
              class="d-flex align-center justify-space-between mb-2 atalho-loja"
            >
              <v-chip :color="lojaColor[l.loja]" variant="tonal" size="small" class="font-weight-medium">{{ l.loja }}</v-chip>
              <span class="font-weight-bold">{{ nf(l.total) }}</span>
            </NuxtLink>
            <div v-if="!porLoja.length" class="text-caption text-medium-emphasis">Nenhuma loja com produtos ainda.</div>
          </v-card>

          <v-card flat border rounded="lg" class="pa-4">
            <div class="text-subtitle-1 font-weight-bold mb-3">Atividades recentes</div>
            <NuxtLink v-for="(r, i) in data.recentes" :key="i" :to="`/produtos/${r.id}`" class="d-flex align-center ga-3 mb-3 atalho-loja">
              <v-avatar color="bege" size="34" rounded="lg"><v-icon size="18" color="primary">inventory_2</v-icon></v-avatar>
              <div style="min-width: 0">
                <div class="text-body-2 font-weight-medium text-truncate">{{ r.nome }}</div>
                <div class="text-caption text-medium-emphasis">{{ r.createdByName || '—' }} · {{ r.loja }} · {{ quando(r.createdAt) }}</div>
              </div>
            </NuxtLink>
            <div v-if="!data.recentes.length" class="text-caption text-medium-emphasis">Nenhuma atividade recente.</div>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </div>
</template>

<style scoped>
/* atalhos do dashboard: clicáveis, sem cara de link cru */
.atalho-loja { color: inherit; text-decoration: none; }
.atalho-loja:hover { opacity: 0.7; }
</style>
