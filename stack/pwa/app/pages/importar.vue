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
// importou, mas a aba da loja nao recebeu: aviso, nao erro — os produtos entraram
const espelhoFalhou = ref(false);
const erro = ref('');

const headers = [
  { title: 'Nome', key: 'nome' },
  { title: 'Marca', key: 'marca' },
  { title: 'Tipo', key: 'tipo' },
  { title: 'Cód. interno', key: 'codigoInterno' },
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
  espelhoFalhou.value = false;
  try {
    const r = await api.importBase([...selected.value]);
    /*
     * O servidor devolve como terminou o espelho na aba da loja. Ignorar isso
     * era o defeito: os produtos entravam no banco, a aba não recebia, e a tela
     * dizia só "importados".
     */
    const espelho = r.espelhoLoja === 'falhou'
      ? ' A aba da sua loja não recebeu estes produtos; ficam pendentes de reenvio.'
      : r.espelhoLoja === 'espelhado'
        ? ' A aba da sua loja também foi atualizada.'
        : '';
    msg.value = `${r.imported} produto(s) importado(s), ${r.skipped} já existia(m) na sua loja.${espelho}`;
    espelhoFalhou.value = r.espelhoLoja === 'falhou';
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

    <v-alert v-if="msg" :type="espelhoFalhou ? 'warning' : 'success'" variant="tonal" class="mb-4">{{ msg }}</v-alert>
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
        <template #[`item.nome`]="{ item }">
          <div class="d-flex align-center justify-space-between ga-2" style="min-width: 220px">
            <span class="font-weight-medium">{{ item.nome }}</span>
            <v-chip v-if="item.importado === false" size="x-small" color="primary" variant="tonal" label class="font-weight-bold flex-shrink-0">Novo</v-chip>
            <v-chip v-else-if="item.importado === true" size="x-small" color="secondary" label class="font-weight-bold flex-shrink-0">Importado</v-chip>
          </div>
        </template>
        <template #[`item.tipo`]="{ item }">
          <v-chip size="x-small" label :color="item.tipo === 'revenda' ? 'primary' : 'secondary'">
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
