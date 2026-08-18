<script setup lang="ts">
import { ProductRules } from '@pralis/shared';
import type { ProductSchemas } from '@pralis/shared';

type Product = ProductSchemas.ProductEntity;

const api = useApi();
const { user } = useAuth();
const flash = useFlash();
// aviso vindo do formulário (ex.: espelhamento na planilha pendente)
const mostrarFlash = computed({
  get: () => !!flash.value,
  set: (v: boolean) => { if (!v) flash.value = null; },
});
const products = ref<Product[]>([]);
const search = ref('');
const loading = ref(false);
const erro = ref('');
let timer: ReturnType<typeof setInterval> | null = null;

// Admin enxerga o catálogo Geral (BASE) e o de cada loja; usuário comum só a própria loja.
const isAdmin = computed(() => user.value?.role === 'admin');
const abas = [
  { key: 'BASE', label: 'Geral (Base)' },
  { key: 'TNP', label: 'TNP' },
  { key: 'LI', label: 'LI' },
  // HORA desabilitada por enquanto
] as const;
const aba = ref<'BASE' | 'TNP' | 'LI' | 'HORA'>('BASE');

// filtros (sem "Todos" — nada selecionado = sem filtro; pílulas alternam/limpam)
const statusFiltro = ref<'ativo' | 'inativo' | null>(null);
const statusOpcoes = [
  { value: 'ativo', label: 'Ativos' },
  { value: 'inativo', label: 'Inativos' },
] as const;
const tipoFiltro = ref<'revenda' | 'transformacao' | null>(null);
const tipoOpcoes = [
  { value: 'revenda', label: 'Revenda' },
  { value: 'transformacao', label: 'Transformação' },
] as const;
const setorFiltro = ref<string | null>(null);
const grupoFiltro = ref<string | null>(null);
const setores = computed(() => [...new Set(products.value.map((p) => p.setorEstoque).filter((s): s is string => !!s))]);
const grupos = computed(() => [...new Set(products.value.map((p) => p.grupo).filter((g): g is string => !!g))]);

// ordenação
const ordenar = ref<'recentes' | 'antigos' | 'az' | 'za' | 'codigo_asc' | 'codigo_desc'>('recentes');
const ordenarOpcoes = [
  { value: 'recentes', label: 'Mais recentes' },
  { value: 'antigos', label: 'Mais antigos' },
  { value: 'az', label: 'Nome (A–Z)' },
  { value: 'za', label: 'Nome (Z–A)' },
  { value: 'codigo_asc', label: 'Código (00001 →)' },
  { value: 'codigo_desc', label: 'Código (→ 00001)' },
] as const;

// painel de filtros (mostra/esconde) + contador de filtros ativos
const mostrarFiltros = ref(false);
const numFiltros = computed(
  () =>
    [statusFiltro.value, tipoFiltro.value, setorFiltro.value, grupoFiltro.value].filter(Boolean).length +
    (ordenar.value !== 'recentes' ? 1 : 0),
);
const temFiltro = computed(() => numFiltros.value > 0 || !!search.value);
function limparFiltros() {
  statusFiltro.value = null;
  tipoFiltro.value = null;
  setorFiltro.value = null;
  grupoFiltro.value = null;
  ordenar.value = 'recentes';
  search.value = '';
}

const page = ref(1);
const PER_PAGE = 10;

const filtrados = computed(() =>
  products.value.filter((p) => {
    if (statusFiltro.value && p.status !== statusFiltro.value) return false;
    if (tipoFiltro.value && p.tipo !== tipoFiltro.value) return false;
    if (setorFiltro.value && p.setorEstoque !== setorFiltro.value) return false;
    if (grupoFiltro.value && p.grupo !== grupoFiltro.value) return false;
    return true;
  }),
);
const codigoNum = (p: Product) => Number(p.codigoInterno) || 0;
const ordenados = computed(() => {
  const arr = [...filtrados.value];
  switch (ordenar.value) {
    case 'antigos': return arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || codigoNum(a) - codigoNum(b));
    case 'az': return arr.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    case 'za': return arr.sort((a, b) => b.nome.localeCompare(a.nome, 'pt-BR'));
    case 'codigo_asc': return arr.sort((a, b) => codigoNum(a) - codigoNum(b));
    case 'codigo_desc': return arr.sort((a, b) => codigoNum(b) - codigoNum(a));
    default: return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || codigoNum(b) - codigoNum(a)); // recentes (último → primeiro)
  }
});
const totalPaginas = computed(() => Math.max(1, Math.ceil(ordenados.value.length / PER_PAGE)));
const paginados = computed(() => ordenados.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE));

// volta pra página 1 ao trocar filtro/ordem/busca/aba; mantém a página válida quando a lista muda
watch([statusFiltro, tipoFiltro, setorFiltro, grupoFiltro, ordenar, search, aba], () => { page.value = 1; });
watch(totalPaginas, (n) => { if (page.value > n) page.value = n; });

async function load(silent = false) {
  if (!silent) loading.value = true;
  erro.value = '';
  try {
    const q = search.value || undefined;
    if (isAdmin.value) {
      products.value = aba.value === 'BASE' ? await api.listBase(q) : await api.listProducts(q, aba.value);
    } else {
      products.value = await api.listProducts(q);
    }
  } catch {
    if (!silent) erro.value = 'Não foi possível carregar.';
  } finally {
    if (!silent) loading.value = false;
  }
}

watch(aba, () => load());

async function remover(p: Product) {
  if (!confirm(`Excluir "${p.nome}"?`)) return;
  await api.deleteProduct(p.id);
  await load();
}

onMounted(() => {
  load();
  timer = setInterval(() => load(true), 5000); // polling (atualização "em tempo real")
});
onUnmounted(() => { if (timer) clearInterval(timer); });

// BUG-01: quando o cálculo é automático, o card mostra o V. Venda CALCULADO
// (custo/qtCad + margem); senão, o valor pontual. Mesma regra do formulário.
function preco(p: Product): string | null {
  const v = ProductRules.calcularVVenda({
    auto: p.auto,
    custo: p.custo ?? 0,
    qtCad: p.qtCad,
    margemPontual: p.margemPontual,
    margemGrupo: 0,
    vVendaPontual: p.vVendaPontual ?? 0,
    descricao: p.nome, // não-vazio garante o cálculo (descrição vazia retornaria 0)
  });
  return v ? v.toFixed(2).replace('.', ',') : null;
}
</script>

<template>
  <div>
    <v-snackbar
      v-model="mostrarFlash"
      :color="flash?.tipo ?? 'success'"
      :timeout="flash?.tipo === 'warning' ? 9000 : 4000"
      location="top"
    >
      {{ flash?.texto }}
      <template #actions>
        <v-btn variant="text" @click="mostrarFlash = false">Fechar</v-btn>
      </template>
    </v-snackbar>

    <div class="d-flex align-center mb-4 ga-3 flex-wrap">
      <v-text-field
        v-model="search"
        density="compact"
        variant="outlined"
        hide-details
        placeholder="Buscar produto..."
        prepend-inner-icon="search"
        style="flex: 1 1 220px; max-width: 320px"
        @keyup.enter="load()"
      />
      <v-spacer />
      <!-- botão que mostra/esconde o painel de filtros (estilo marketplace) -->
      <v-btn variant="outlined" color="grey-darken-2" rounded="lg" @click="mostrarFiltros = !mostrarFiltros">
        <v-icon start>tune</v-icon>
        Filtros
        <v-chip v-if="numFiltros" size="x-small" color="primary" class="ml-2 font-weight-bold">{{ numFiltros }}</v-chip>
        <v-icon end size="18">{{ mostrarFiltros ? 'expand_less' : 'expand_more' }}</v-icon>
      </v-btn>
      <v-btn v-if="!isAdmin" variant="tonal" color="primary" prepend-icon="download" to="/importar">Importar da base</v-btn>
      <!-- só o admin cadastra produto novo (sempre na base geral) -->
      <v-btn v-if="isAdmin" color="primary" prepend-icon="add" to="/produtos/novo">Novo</v-btn>
    </div>

    <!-- painel de filtros (abre/fecha) -->
    <v-expand-transition>
      <v-card v-show="mostrarFiltros" flat border rounded="lg" class="pa-3 mb-4">
        <div class="d-flex flex-column flex-sm-row flex-sm-wrap align-stretch align-sm-center ga-3">
          <!-- Status -->
          <div class="d-flex align-center ga-2 flex-wrap">
            <span class="text-caption text-medium-emphasis" style="width: 44px">Status</span>
            <v-btn
              v-for="s in statusOpcoes"
              :key="s.value"
              size="small"
              rounded="lg"
              :variant="statusFiltro === s.value ? 'flat' : 'outlined'"
              :color="statusFiltro === s.value ? 'primary' : 'grey-darken-1'"
              @click="statusFiltro = statusFiltro === s.value ? null : s.value"
            >
              {{ s.label }}
            </v-btn>
          </div>
          <v-divider vertical class="mx-1 d-none d-sm-flex" style="height: 24px; align-self: center" />
          <!-- Tipo -->
          <div class="d-flex align-center ga-2 flex-wrap">
            <span class="text-caption text-medium-emphasis" style="width: 44px">Tipo</span>
            <v-btn
              v-for="t in tipoOpcoes"
              :key="t.value"
              size="small"
              rounded="lg"
              :variant="tipoFiltro === t.value ? 'flat' : 'outlined'"
              :color="tipoFiltro === t.value ? 'primary' : 'grey-darken-1'"
              @click="tipoFiltro = tipoFiltro === t.value ? null : t.value"
            >
              {{ t.label }}
            </v-btn>
          </div>
          <v-divider vertical class="mx-1 d-none d-sm-flex" style="height: 24px; align-self: center" />
          <v-select v-model="setorFiltro" :items="setores" label="Setor" density="compact" variant="outlined" hide-details clearable rounded="lg" prepend-inner-icon="warehouse" class="filtro-select filtro-item" />
          <v-select v-model="grupoFiltro" :items="grupos" label="Grupo" density="compact" variant="outlined" hide-details clearable rounded="lg" prepend-inner-icon="sell" class="filtro-select filtro-item" />
          <v-select v-model="ordenar" :items="ordenarOpcoes" item-title="label" item-value="value" label="Ordenar" density="compact" variant="outlined" hide-details rounded="lg" prepend-inner-icon="swap_vert" class="filtro-select filtro-item" />
          <v-spacer class="d-none d-sm-block" />
          <v-btn v-if="temFiltro" size="small" variant="text" color="medium-emphasis" prepend-icon="close" class="align-self-start align-self-sm-center" @click="limparFiltros">Limpar</v-btn>
        </div>
      </v-card>
    </v-expand-transition>

    <!-- Admin: alterna entre o catálogo Geral (Base) e o de cada loja -->
    <v-tabs v-if="isAdmin" v-model="aba" color="primary" density="compact" class="mb-4">
      <v-tab v-for="t in abas" :key="t.key" :value="t.key">{{ t.label }}</v-tab>
    </v-tabs>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <v-row v-if="paginados.length">
      <v-col v-for="p in paginados" :key="p.id" cols="12" sm="6" md="4">
        <v-card border flat rounded="lg" class="h-100 product-card">
          <v-card-item>
            <div class="d-flex align-center justify-space-between ga-2">
              <div class="d-flex align-center ga-3" style="min-width: 0">
                <v-avatar size="46" rounded="lg" :color="p.fotoUrl ? undefined : 'bege'">
                  <v-img v-if="p.fotoUrl" :src="p.fotoUrl" cover />
                  <v-icon v-else color="primary">inventory_2</v-icon>
                </v-avatar>
                <div style="min-width: 0">
                  <div class="text-subtitle-1 font-weight-bold text-truncate">{{ p.nome }}</div>
                  <div class="text-caption text-medium-emphasis">{{ p.codigoInterno || '—' }}</div>
                </div>
              </div>
              <v-chip :color="p.status === 'ativo' ? 'success' : 'grey'" variant="tonal" size="small" class="font-weight-medium flex-shrink-0">
                {{ p.status === 'ativo' ? 'Ativo' : 'Inativo' }}
              </v-chip>
            </div>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <div class="d-flex justify-space-between align-center text-body-2 mb-2">
              <span class="text-medium-emphasis">TIPO</span>
              <v-chip size="x-small" variant="tonal" class="font-weight-medium" :color="p.tipo === 'revenda' ? 'primary' : 'secondary'">
                {{ p.tipo === 'revenda' ? 'Revenda' : 'Transformação' }}
              </v-chip>
            </div>
            <div class="d-flex justify-space-between text-body-2 mb-1">
              <span class="text-medium-emphasis">GRAMATURA</span>
              <span>{{ p.quantidade }} {{ p.medidaBase }}</span>
            </div>
            <div class="d-flex justify-space-between text-body-2 mb-1">
              <span class="text-medium-emphasis">MARCA</span>
              <span>{{ p.marca || '—' }}</span>
            </div>
            <div v-if="preco(p)" class="d-flex justify-space-between text-body-2 mb-1">
              <span class="text-medium-emphasis">V. VENDA</span>
              <span class="font-weight-bold">R$ {{ preco(p) }}</span>
            </div>
            <div v-if="p.createdByName" class="text-caption text-medium-emphasis mt-2">
              <v-icon size="13">person</v-icon> cadastrado por {{ p.createdByName }}
            </div>
          </v-card-text>
          <v-divider />
          <v-card-actions>
            <!-- editar: admin e colaborador; excluir: só admin -->
            <v-btn size="small" variant="text" :to="`/produtos/${p.id}`" prepend-icon="edit">Editar</v-btn>
            <v-spacer />
            <v-btn v-if="isAdmin" size="small" variant="text" color="error" prepend-icon="delete" @click="remover(p)">Excluir</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <v-card v-else-if="!loading && !erro" flat border rounded="lg" class="pa-12 text-center text-medium-emphasis">
      <v-icon size="48" class="mb-2">inventory_2</v-icon>
      <div>{{ temFiltro ? 'Nenhum produto com esses filtros.' : 'Nenhum produto cadastrado ainda.' }}</div>
      <v-btn v-if="temFiltro" color="primary" variant="tonal" class="mt-4" @click="limparFiltros">Limpar filtros</v-btn>
      <v-btn v-else color="primary" variant="tonal" class="mt-4" to="/produtos/novo">Cadastrar o primeiro</v-btn>
    </v-card>

    <!-- paginação (10 por página) -->
    <div v-if="filtrados.length" class="d-flex align-center justify-space-between mt-4 flex-wrap ga-2">
      <div class="text-caption text-medium-emphasis">
        {{ filtrados.length }} produto(s) · página {{ page }} de {{ totalPaginas }}
      </div>
      <v-pagination
        v-if="totalPaginas > 1"
        v-model="page"
        :length="totalPaginas"
        :total-visible="6"
        density="comfortable"
        rounded="lg"
        active-color="primary"
      />
    </div>
  </div>
</template>

<style scoped>
/* selects do filtro: largura total no mobile, limitada no desktop */
.filtro-item {
  width: 100%;
}
@media (min-width: 600px) {
  .filtro-item {
    width: auto;
    min-width: 175px;
    max-width: 230px;
  }
}
/* filtros setor/grupo no mesmo padrão compacto das pílulas */
.filtro-select :deep(.v-field) {
  min-height: 32px;
  font-size: 0.82rem;
}
.filtro-select :deep(.v-field__input) {
  min-height: 32px;
  padding-top: 0;
  padding-bottom: 0;
  --v-input-control-height: 32px;
}
.filtro-select :deep(.v-field__prepend-inner),
.filtro-select :deep(.v-field__append-inner) {
  padding-top: 4px;
}
.filtro-select :deep(.v-field-label) {
  top: 6px;
  font-size: 0.82rem;
}
.product-card {
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.product-card:hover {
  transform: translateY(-2px);
  box-shadow:
    0 2px 6px rgba(29, 29, 31, 0.06),
    0 12px 28px rgba(29, 29, 31, 0.08) !important;
}
</style>
