<script setup lang="ts">
import type { HistoricoNomeProduto } from '~/composables/useApi';

const api = useApi();
const flash = useFlash();
const carregando = ref(true);
const linhas = ref<HistoricoNomeProduto[]>([]);
const busca = ref('');
const atualizadoEm = ref<Date | null>(null);

function quando(valor: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(valor));
}

async function carregar(silencioso = false) {
  if (!silencioso) carregando.value = true;
  try {
    linhas.value = await api.historicoNomes();
    atualizadoEm.value = new Date();
  } catch (error: unknown) {
    flash.value = {
      texto: (error as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar o histórico.',
      tipo: 'error',
    };
  } finally {
    if (!silencioso) carregando.value = false;
  }
}

const linhasVisiveis = computed(() => {
  const termo = busca.value.trim().toLocaleLowerCase('pt-BR');
  if (!termo) return linhas.value;
  return linhas.value.filter((linha) => [
    linha.codigo,
    linha.codigoInterno,
    linha.loja,
    linha.nomeAnterior,
    linha.nomeNovo,
    linha.alteradoPorNome,
  ].some((valor) => valor?.toLocaleLowerCase('pt-BR').includes(termo)));
});

let atualizacaoAutomatica: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void carregar();
  atualizacaoAutomatica = setInterval(() => void carregar(true), 15_000);
});
onBeforeUnmount(() => {
  if (atualizacaoAutomatica) clearInterval(atualizacaoAutomatica);
});
</script>

<template>
  <div class="mx-auto" style="max-width: 1200px">
    <div class="d-flex flex-wrap align-center justify-space-between ga-3 mb-5">
      <div>
        <h1 class="text-h4 font-weight-bold">Histórico de nomes</h1>
        <p class="text-body-2 text-medium-emphasis mt-1 mb-0">
          Todas as trocas de nome feitas no cadastro, com atualização automática a cada 15 segundos.
        </p>
      </div>
      <div class="d-flex ga-2">
        <v-btn color="primary" variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar()">Atualizar</v-btn>
      </div>
    </div>

    <v-card flat border rounded="lg">
      <v-progress-linear v-if="carregando" indeterminate color="primary" />
      <div class="d-flex flex-wrap align-center ga-3 px-4 pt-4">
        <v-text-field
          v-model="busca"
          label="Buscar produto, código, loja ou pessoa"
          prepend-inner-icon="search"
          density="compact"
          hide-details
          style="max-width: 440px"
        />
        <v-spacer />
        <span class="text-caption text-medium-emphasis">
          {{ linhasVisiveis.length }} de {{ linhas.length }} alterações
          <template v-if="atualizadoEm"> · atualizado às {{ atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}</template>
        </span>
      </div>
      <v-table v-if="!carregando && linhasVisiveis.length" density="comfortable">
        <thead>
          <tr>
            <th>Data</th><th>Produto</th><th>Antes</th><th>Depois</th><th>Alterado por</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="linha in linhasVisiveis" :key="linha.id">
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
      <div v-else-if="!carregando && linhas.length" class="text-center text-medium-emphasis pa-10">
        Nenhuma alteração encontrada para a busca informada.
      </div>
      <div v-else-if="!carregando" class="text-center text-medium-emphasis pa-10">
        Nenhum nome foi alterado desde a criação deste histórico.
      </div>
    </v-card>
  </div>
</template>
