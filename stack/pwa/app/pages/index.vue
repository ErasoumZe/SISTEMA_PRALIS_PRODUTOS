<script setup lang="ts">
import type { ProductSchemas } from '@pralis/shared';

type Product = ProductSchemas.ProductEntity;

const api = useApi();
const products = ref<Product[]>([]);
const search = ref('');
const loading = ref(false);
const erro = ref('');

async function load() {
  loading.value = true;
  erro.value = '';
  try {
    products.value = await api.listProducts(search.value || undefined);
  } catch (e: unknown) {
    erro.value = 'Não foi possível carregar (a API está rodando em :3344?).';
  } finally {
    loading.value = false;
  }
}

async function remover(p: Product) {
  if (!confirm(`Excluir "${p.nome}"?`)) return;
  await api.deleteProduct(p.id);
  await load();
}

onMounted(load);

function precoLoja(p: Product): string | null {
  const v = p.lojas?.[0]?.vVendaPontual ?? null;
  return v != null ? v.toFixed(2).replace('.', ',') : null;
}
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4 ga-3 flex-wrap">
      <h1 class="text-h5 font-weight-bold">Produtos</h1>
      <v-spacer />
      <v-text-field
        v-model="search"
        density="compact"
        variant="outlined"
        hide-details
        placeholder="Buscar..."
        prepend-inner-icon="mdi-magnify"
        style="max-width: 280px"
        @keyup.enter="load"
      />
      <v-btn color="primary" prepend-icon="mdi-plus" to="/produtos/novo">Novo</v-btn>
    </div>

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
            <div v-if="precoLoja(p)" class="d-flex justify-space-between text-body-2">
              <span class="text-medium-emphasis">V. VENDA</span>
              <span class="font-weight-bold">R$ {{ precoLoja(p) }}</span>
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
