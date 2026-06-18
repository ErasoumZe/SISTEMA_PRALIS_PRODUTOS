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
        prepend-inner-icon="mdi-magnify"
        style="max-width: 280px"
        @keyup.enter="load()"
      />
      <v-spacer />
      <v-btn v-if="!isAdmin" variant="tonal" color="primary" prepend-icon="mdi-database-import" to="/importar">Importar da base</v-btn>
      <v-btn color="primary" prepend-icon="mdi-plus" to="/produtos/novo">Novo</v-btn>
    </div>

    <!-- Admin: alterna entre o catálogo Geral (Base) e o de cada loja -->
    <v-tabs v-if="isAdmin" v-model="aba" color="primary" density="compact" class="mb-4">
      <v-tab v-for="t in abas" :key="t.key" :value="t.key">{{ t.label }}</v-tab>
    </v-tabs>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <v-row v-if="products.length">
      <v-col v-for="p in products" :key="p.id" cols="12" sm="6" md="4">
        <v-card border flat rounded="lg" class="h-100">
          <v-card-item>
            <div class="d-flex align-center justify-space-between ga-2">
              <div class="d-flex align-center ga-3" style="min-width: 0">
                <v-avatar size="44" rounded="lg" :color="p.fotoUrl ? undefined : 'grey-lighten-3'">
                  <v-img v-if="p.fotoUrl" :src="p.fotoUrl" cover />
                  <v-icon v-else color="grey">mdi-package-variant-closed</v-icon>
                </v-avatar>
                <div style="min-width: 0">
                  <div class="text-subtitle-1 font-weight-bold text-truncate">{{ p.nome }}</div>
                  <div class="text-caption text-medium-emphasis">{{ p.codigo }}</div>
                </div>
              </div>
              <v-chip :color="p.status === 'ativo' ? 'green' : 'grey'" size="small" label>
                {{ p.status === 'ativo' ? 'Ativo' : 'Inativo' }}
              </v-chip>
            </div>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <div class="d-flex justify-space-between text-body-2 mb-1">
              <span class="text-medium-emphasis">TIPO</span>
              <v-chip size="x-small" label :color="p.tipo === 'revenda' ? 'primary' : 'orange'">
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
              <v-icon size="13">mdi-account</v-icon> cadastrado por {{ p.createdByName }}
            </div>
          </v-card-text>
          <v-divider />
          <v-card-actions>
            <v-btn size="small" variant="text" :to="`/produtos/${p.id}`" prepend-icon="mdi-pencil">Editar</v-btn>
            <v-spacer />
            <v-btn size="small" variant="text" color="error" prepend-icon="mdi-delete" @click="remover(p)">Excluir</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <v-card v-else-if="!loading && !erro" flat border rounded="lg" class="pa-12 text-center text-medium-emphasis">
      <v-icon size="48" class="mb-2">mdi-package-variant</v-icon>
      <div>Nenhum produto cadastrado ainda.</div>
      <v-btn color="primary" variant="tonal" class="mt-4" to="/produtos/novo">Cadastrar o primeiro</v-btn>
    </v-card>
  </div>
</template>
