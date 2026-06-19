<script setup lang="ts">
import type { ProductSchemas } from '@pralis/shared';

type Product = ProductSchemas.ProductEntity;

const api = useApi();
const { user } = useAuth();

const baseProducts = ref<Product[]>([]);
const selected = ref<string[]>([]);
const search = ref('');
const loading = ref(false);
const importing = ref(false);
const msg = ref('');
const erro = ref('');

const headers = [
  { title: 'Nome', key: 'nome' },
  { title: 'Marca', key: 'marca' },
  { title: 'Tipo', key: 'tipo' },
  { title: 'Código', key: 'codigo' },
] as const;

async function load() {
  loading.value = true;
  erro.value = '';
  try {
    baseProducts.value = await api.listBase();
  } catch {
    erro.value = 'Não foi possível carregar o catálogo base.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function importar() {
  if (!selected.value.length) return;
  importing.value = true;
  msg.value = '';
  erro.value = '';
  try {
    const r = await api.importBase([...selected.value]);
    msg.value = `${r.imported} produto(s) importado(s), ${r.skipped} já existia(m) na sua loja.`;
    selected.value = [];
    await load();
  } catch (e: unknown) {
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Falha na importação.';
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4 ga-3 flex-wrap">
      <v-btn icon="arrow_back" variant="text" to="/" />
      <h1 class="text-h5 font-weight-bold">Importar da base</h1>
      <v-chip v-if="user" color="primary" size="small" label prepend-icon="storefront">→ Loja {{ user.loja }}</v-chip>
      <v-spacer />
      <v-btn
        color="primary"
        :loading="importing"
        :disabled="!selected.length"
        prepend-icon="download"
        @click="importar"
      >
        Importar selecionados ({{ selected.length }})
      </v-btn>
    </div>

    <v-alert v-if="msg" type="success" variant="tonal" class="mb-4">{{ msg }}</v-alert>
    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <v-card flat border rounded="lg">
      <v-text-field
        v-model="search"
        density="compact"
        variant="solo-filled"
        flat
        hide-details
        placeholder="Buscar na base..."
        prepend-inner-icon="search"
        class="pa-2"
      />
      <v-data-table
        v-model="selected"
        :headers="headers"
        :items="baseProducts"
        :search="search"
        :loading="loading"
        item-value="id"
        show-select
        density="comfortable"
        items-per-page="25"
      >
        <template #[`item.tipo`]="{ item }">
          <v-chip size="x-small" label :color="item.tipo === 'revenda' ? 'primary' : 'orange'">
            {{ item.tipo === 'revenda' ? 'Revenda' : 'Transformação' }}
          </v-chip>
        </template>
        <template #no-data>
          <div class="pa-6 text-center text-medium-emphasis">
            A base está vazia. (Os produtos da planilha serão importados pela administração.)
          </div>
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>
