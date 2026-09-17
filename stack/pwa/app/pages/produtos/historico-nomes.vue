<script setup lang="ts">
import type { HistoricoNomeProduto } from '~/composables/useApi';

const api = useApi();
const flash = useFlash();
const carregando = ref(true);
const linhas = ref<HistoricoNomeProduto[]>([]);

function quando(valor: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(valor));
}

async function carregar() {
  carregando.value = true;
  try {
    linhas.value = await api.historicoNomes();
  } catch (error: unknown) {
    flash.value = {
      texto: (error as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar o histórico.',
      tipo: 'error',
    };
  } finally {
    carregando.value = false;
  }
}

onMounted(() => void carregar());
</script>

<template>
  <div class="mx-auto" style="max-width: 1200px">
    <div class="d-flex flex-wrap align-center justify-space-between ga-3 mb-5">
      <div>
        <h1 class="text-h4 font-weight-bold">Histórico de nomes</h1>
        <p class="text-body-2 text-medium-emphasis mt-1 mb-0">
          Cada troca de nome feita no cadastro, com o valor anterior, o novo valor e quem alterou.
        </p>
      </div>
      <div class="d-flex ga-2">
        <v-btn variant="tonal" prepend-icon="arrow_back" to="/produtos/central">Central</v-btn>
        <v-btn color="primary" variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">Atualizar</v-btn>
      </div>
    </div>

    <v-card flat border rounded="lg">
      <v-progress-linear v-if="carregando" indeterminate color="primary" />
      <v-table v-else-if="linhas.length" density="comfortable">
        <thead>
          <tr>
            <th>Data</th><th>Produto</th><th>Antes</th><th>Depois</th><th>Alterado por</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="linha in linhas" :key="linha.id">
            <td class="text-no-wrap">{{ quando(linha.alteradoEm) }}</td>
            <td>
              <NuxtLink :to="`/produtos/${linha.productId}`" class="text-primary font-weight-medium">
                {{ linha.codigoInterno || linha.codigo }}
              </NuxtLink>
              <div class="text-caption text-medium-emphasis">{{ linha.loja }}</div>
            </td>
            <td>{{ linha.nomeAnterior }}</td>
            <td class="font-weight-medium">{{ linha.nomeNovo }}</td>
            <td>{{ linha.alteradoPorNome || 'Usuário removido' }}</td>
          </tr>
        </tbody>
      </v-table>
      <div v-else-if="!carregando" class="text-center text-medium-emphasis pa-10">
        Nenhum nome foi alterado desde a criação deste histórico.
      </div>
    </v-card>
  </div>
</template>
