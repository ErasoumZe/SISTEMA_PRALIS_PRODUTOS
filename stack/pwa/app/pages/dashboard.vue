<script setup lang="ts">
import type { ApexOptions } from 'apexcharts';
import type { AdminSchemas } from '@pralis/shared';

const api = useApi();
const data = ref<AdminSchemas.Dashboard | null>(null);
const loading = ref(true);
const erro = ref('');
const atualizadoEm = ref<Date | null>(null);
const usuarioSelecionado = ref<string | null>(null);

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
const saudacao = computed(() => {
  const hora = new Date().getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
});
const hoje = computed(() => new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long', day: 'numeric', month: 'long',
}).format(new Date()));

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
  const todos = data.value?.produtividade ?? [];
  const p = usuarioSelecionado.value ? todos.filter((item) => item.id === usuarioSelecionado.value) : todos;
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
const usuariosDashboard = computed(() => data.value?.produtividade ?? []);
const usuarioEmFoco = computed(() => usuariosDashboard.value.find((item) => item.id === usuarioSelecionado.value) ?? null);
const temProdutividade = computed(() => produtividade.value.series[0].data.some((total) => total > 0));
const atividadesRecentes = computed(() => {
  if (!usuarioSelecionado.value) return data.value?.recentes ?? [];
  return (data.value?.recentes ?? []).filter((item) => item.createdByUserId === usuarioSelecionado.value);
});
const temDias = computed(() => (data.value?.porDia.length ?? 0) > 0);

function quando(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const lojaColor: Record<string, string> = { TNP: 'primary', LI: 'teal', HORA: 'secondary', BASE: 'primary' };
</script>

<template>
  <div class="dashboard-shell cx-page">
    <section class="dashboard-hero mb-6">
      <div class="d-flex flex-wrap align-center justify-space-between ga-5">
        <div>
          <div class="hero-kicker"><v-icon size="15">auto_awesome</v-icon> VISÃO ADMINISTRATIVA</div>
          <h1 class="hero-title">{{ saudacao }}.</h1>
          <p class="hero-subtitle">Acompanhe o ritmo dos cadastros em um só lugar.</p>
          <div class="hero-status">
            <span class="status-dot" />
            {{ hoje }}
            <template v-if="atualizadoEm"> · atualizado às {{ atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}</template>
          </div>
        </div>
        <v-btn class="hero-refresh" variant="flat" prepend-icon="refresh" :loading="loading" @click="load">Atualizar</v-btn>
      </div>
    </section>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
    <v-progress-linear v-if="loading && !data" indeterminate color="primary" class="mb-4" />

    <template v-if="data">
      <v-row class="metric-grid mb-3">
        <v-col v-for="c in cards" :key="c.label" cols="12" sm="6" lg="4">
          <v-card
            flat
            rounded="xl"
            class="metric-card pa-4 h-100"
            :style="{ '--metric-color': c.color }"
            :to="c.atalho"
            :hover="!!c.atalho"
            :ripple="!!c.atalho"
          >
            <div class="d-flex align-start ga-3">
              <v-avatar class="metric-icon" size="44" rounded="lg" variant="flat">
                <v-icon>{{ c.icon }}</v-icon>
              </v-avatar>
              <div style="min-width: 0">
                <div class="metric-label">{{ c.label }}</div>
                <div class="metric-value">{{ nf(c.value) }}</div>
                <div v-if="c.hint" class="metric-hint">{{ c.hint }}</div>
              </div>
              <v-icon v-if="c.atalho" class="ms-auto metric-arrow" size="18">arrow_outward</v-icon>
            </div>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <!-- produtividade -->
        <v-col cols="12" md="8">
          <v-card flat rounded="xl" class="dashboard-panel pa-5 h-100">
            <div class="panel-heading">
              <div><div class="panel-title">Produtividade por usuário</div><div class="panel-subtitle">Todos os cadastros atribuídos, inclusive o catálogo Base</div></div>
              <v-avatar class="panel-icon" size="38"><v-icon size="20">bar_chart</v-icon></v-avatar>
            </div>
            <div class="user-filter mt-4 mb-2">
              <v-select
                v-model="usuarioSelecionado"
                :items="usuariosDashboard"
                item-title="nome"
                item-value="id"
                label="Todos os usuários"
                prepend-inner-icon="person_search"
                clearable
                hide-details
                density="compact"
                variant="outlined"
                flat
              >
                <template #item="{ props, item }">
                  <v-list-item v-bind="props" :title="item.raw.nome" :subtitle="`${nf(item.raw.total)} produtos cadastrados`" />
                </template>
              </v-select>
              <div v-if="usuarioEmFoco" class="user-focus-count">
                {{ usuarioEmFoco.nome }}: <strong>{{ nf(usuarioEmFoco.total) }}</strong> produtos cadastrados
              </div>
            </div>
            <client-only>
              <apexchart v-if="temProdutividade" type="bar" :height="Math.max(260, produtividade.series[0].data.length * 54)" :options="produtividade.options" :series="produtividade.series" />
            </client-only>
            <div v-if="!temProdutividade" class="text-center text-medium-emphasis py-10">
              <v-icon size="40" class="mb-2">bar_chart</v-icon>
              <div>{{ usuarioEmFoco ? `${usuarioEmFoco.nome} ainda não tem produtos atribuídos.` : 'Ainda não há produtos atribuídos a usuários.' }}</div>
            </div>
          </v-card>
        </v-col>

        <!-- donut ativos/inativos -->
        <v-col cols="12" md="4">
          <v-card flat rounded="xl" class="dashboard-panel pa-5 h-100">
            <div class="panel-heading"><div><div class="panel-title">Resumo de cadastros</div><div class="panel-subtitle">Ativos x inativos</div></div><v-avatar class="panel-icon" size="38"><v-icon size="20">donut_large</v-icon></v-avatar></div>
            <client-only>
              <apexchart type="donut" height="280" :options="donut.options" :series="donut.series" />
            </client-only>
          </v-card>
        </v-col>

        <!-- cadastros por dia -->
        <v-col cols="12" md="8">
          <v-card flat rounded="xl" class="dashboard-panel pa-5 h-100">
            <div class="panel-heading"><div><div class="panel-title">Cadastros por dia</div><div class="panel-subtitle">Últimos 30 dias nas lojas</div></div><v-avatar class="panel-icon" size="38"><v-icon size="20">monitoring</v-icon></v-avatar></div>
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
          <v-card flat rounded="xl" class="dashboard-panel pa-5 mb-4">
            <div class="panel-heading mb-3"><div class="panel-title">Produtos por loja</div><v-avatar class="panel-icon" size="38"><v-icon size="20">storefront</v-icon></v-avatar></div>
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

          <v-card flat rounded="xl" class="dashboard-panel pa-5">
            <div class="panel-heading mb-3"><div><div class="panel-title">Atividades recentes</div><div class="panel-subtitle">{{ usuarioEmFoco ? `Últimos produtos de ${usuarioEmFoco.nome}` : 'Últimos produtos registrados' }}</div></div><v-avatar class="panel-icon" size="38"><v-icon size="20">schedule</v-icon></v-avatar></div>
            <NuxtLink v-for="(r, i) in atividadesRecentes" :key="i" :to="`/produtos/${r.id}`" class="activity-row d-flex align-center ga-3 mb-2">
              <v-avatar class="activity-icon" size="36" rounded="lg"><v-icon size="18">inventory_2</v-icon></v-avatar>
              <div style="min-width: 0">
                <div class="text-body-2 font-weight-medium text-truncate">{{ r.nome }}</div>
                <div class="text-caption text-medium-emphasis">{{ r.createdByName || '—' }} · {{ r.loja }} · {{ quando(r.createdAt) }}</div>
              </div>
            </NuxtLink>
            <div v-if="!atividadesRecentes.length" class="text-caption text-medium-emphasis">Nenhuma atividade recente para este usuário.</div>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </div>
</template>

<style scoped>
.dashboard-shell { min-width: 0; }
.dashboard-hero {
  padding: var(--cx-space-8);
  border: 1px solid var(--cx-line);
  border-radius: var(--cx-r-xl);
  background: var(--cx-surface);
}
.hero-kicker {
  display: flex;
  align-items: center;
  gap: var(--cx-space-2);
  color: var(--cx-brand);
  font-size: var(--cx-text-xs);
  font-weight: 700;
  letter-spacing: .045em;
}
.hero-title {
  margin: var(--cx-space-2) 0 var(--cx-space-1);
  color: var(--cx-ink);
  font-size: clamp(1.6rem, 1.3rem + 1.2vw, 2.1rem);
  font-weight: 750;
  letter-spacing: -.025em;
  line-height: 1.2;
}
.hero-subtitle { margin: 0; color: var(--cx-ink-soft); font-size: var(--cx-text-sm); }
.hero-status {
  display: flex;
  align-items: center;
  gap: var(--cx-space-2);
  margin-top: var(--cx-space-5);
  color: var(--cx-ink-soft);
  font-size: var(--cx-text-xs);
}
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--cx-positive); }
.hero-refresh { color: var(--cx-brand) !important; background: var(--cx-brand-wash) !important; }
.metric-card, .dashboard-panel { border: 1px solid var(--cx-line); background: var(--cx-surface); }
.metric-card { min-width: 0; transition: border-color 140ms var(--cx-ease), background 140ms var(--cx-ease); }
.metric-card[href]:hover { border-color: var(--cx-brand); background: var(--cx-surface-sunken); }
.metric-icon { color: var(--metric-color); background: color-mix(in srgb, var(--metric-color) 12%, white) !important; }
.metric-label { color: var(--cx-ink-soft); font-size: var(--cx-text-xs); font-weight: 700; }
.metric-value { color: var(--cx-ink); font-size: 1.7rem; font-weight: 750; line-height: 1.25; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.metric-hint { color: var(--cx-ink-soft); font-size: var(--cx-text-xs); line-height: 1.4; }
.metric-arrow { color: var(--cx-ink-faint); }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--cx-space-3); }
.panel-title { color: var(--cx-ink); font-size: var(--cx-text-md); font-weight: 700; letter-spacing: -.01em; }
.panel-subtitle { margin-top: 2px; color: var(--cx-ink-soft); font-size: var(--cx-text-xs); }
.panel-icon, .activity-icon { color: var(--cx-brand); background: var(--cx-brand-wash) !important; }
.user-filter { display: flex; align-items: center; gap: var(--cx-space-3); }
.user-focus-count { flex: 1 0 auto; color: var(--cx-ink-soft); font-size: var(--cx-text-xs); }
.atalho-loja, .activity-row { color: inherit; text-decoration: none; border-radius: var(--cx-r-md); transition: background 140ms var(--cx-ease); }
.atalho-loja:hover, .activity-row:hover { background: var(--cx-brand-wash); }
.activity-row { padding: var(--cx-space-1); margin-left: calc(-1 * var(--cx-space-1)); margin-right: calc(-1 * var(--cx-space-1)); }
@media (max-width: 600px) {
  .dashboard-hero { padding: var(--cx-space-5); }
  .hero-refresh { width: 100%; }
  .dashboard-panel { padding: var(--cx-space-4) !important; }
}
@media (max-width: 760px) { .user-filter { align-items: stretch; flex-direction: column; } }
</style>
