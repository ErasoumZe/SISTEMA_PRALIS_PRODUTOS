<script setup lang="ts">
import type { ProductSchemas } from '@pralis/shared';

type Product = ProductSchemas.ProductEntity;

const api = useApi();
const { user } = useAuth();
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
  { key: 'HORA', label: 'HORA' },
] as const;
const aba = ref<'BASE' | 'TNP' | 'LI' | 'HORA'>('BASE');

// filtro de status + paginação (10 por página, no cliente)
const statusFiltro = ref<'todos' | 'ativo' | 'inativo'>('todos');
const statusOpcoes = [
  { value: 'todos', label: 'Todos' },
  { value: 'ativo', label: 'Ativos' },
  { value: 'inativo', label: 'Inativos' },
] as const;
const page = ref(1);
const PER_PAGE = 10;

const filtrados = computed(() =>
  statusFiltro.value === 'todos' ? products.value : products.value.filter((p) => p.status === statusFiltro.value),
);
const totalPaginas = computed(() => Math.max(1, Math.ceil(filtrados.value.length / PER_PAGE)));
const paginados = computed(() => filtrados.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE));

// volta pra página 1 ao trocar filtro/busca/aba; mantém a página válida quando a lista muda (polling/exclusão)
watch([statusFiltro, search, aba], () => { page.value = 1; });
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

function preco(p: Product): string | null {
  const v = p.vVendaPontual ?? null;
  return v != null ? v.toFixed(2).replace('.', ',') : null;
}
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4 ga-3 flex-wrap">
      <v-text-field
        v-model="search"
        density="compact"
        variant="outlined"
        hide-details
        placeholder="Buscar produto..."
        prepend-inner-icon="search"
        style="max-width: 280px"
        @keyup.enter="load()"
      />
      <div class="d-flex ga-2 flex-wrap">
        <v-btn
          v-for="s in statusOpcoes"
          :key="s.value"
          size="small"
          rounded="lg"
          :variant="statusFiltro === s.value ? 'flat' : 'outlined'"
          :color="statusFiltro === s.value ? 'primary' : 'grey-darken-1'"
          @click="statusFiltro = s.value"
        >
          {{ s.label }}
        </v-btn>
      </div>
      <v-spacer />
      <v-btn v-if="!isAdmin" variant="tonal" color="primary" prepend-icon="download" to="/importar">Importar da base</v-btn>
      <v-btn color="primary" prepend-icon="add" to="/produtos/novo">Novo</v-btn>
    </div>

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
                  <div class="text-caption text-medium-emphasis">{{ p.codigo }}</div>
                </div>
              </div>
              <v-chip :color="p.status === 'ativo' ? 'success' : 'grey'" variant="tonal" size="small" class="font-weight-medium">
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
            <v-btn size="small" variant="text" :to="`/produtos/${p.id}`" prepend-icon="edit">Editar</v-btn>
            <v-spacer />
            <v-btn size="small" variant="text" color="error" prepend-icon="delete" @click="remover(p)">Excluir</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <v-card v-else-if="!loading && !erro" flat border rounded="lg" class="pa-12 text-center text-medium-emphasis">
      <v-icon size="48" class="mb-2">inventory_2</v-icon>
      <div>{{ statusFiltro === 'todos' ? 'Nenhum produto cadastrado ainda.' : `Nenhum produto ${statusFiltro === 'ativo' ? 'ativo' : 'inativo'}.` }}</div>
      <v-btn v-if="statusFiltro === 'todos'" color="primary" variant="tonal" class="mt-4" to="/produtos/novo">Cadastrar o primeiro</v-btn>
    </v-card>

    <!-- paginação (10 por página) -->
    <div v-if="filtrados.length" class="d-flex align-center justify-space-between mt-4 flex-wrap ga-2">
      <div class="text-caption text-medium-emphasis">
        {{ filtrados.length }} produto(s){{ statusFiltro !== 'todos' ? ` ${statusFiltro}(s)` : '' }} · página {{ page }} de {{ totalPaginas }}
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
