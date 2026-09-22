<script setup lang="ts">
import type { PreviaDuplicadosHistoricos, TipoConfrontoHistorico } from '~/composables/useApi';

const api = useApi();
const dados = ref<PreviaDuplicadosHistoricos | null>(null);
const carregando = ref(true);
const erro = ref('');
const agindo = ref<string | null>(null);
const confirmacao = ref('');
const tipo = ref<TipoConfrontoHistorico | 'todos'>('todos');

const ROTULO: Record<TipoConfrontoHistorico, string> = {
  'barras-exatas': 'Barras exatas', 'nome-exato': 'Nome exato', revisar: 'Revisar', 'sem-par': 'Sem par',
};
const COR: Record<TipoConfrontoHistorico, string> = {
  'barras-exatas': 'success', 'nome-exato': 'info', revisar: 'warning', 'sem-par': 'secondary',
};
const itens = computed(() => (dados.value?.itens ?? []).filter((i) => tipo.value === 'todos' || i.tipo === tipo.value));
const podeUnificar = (t: TipoConfrontoHistorico) => t === 'barras-exatas' || t === 'nome-exato';

async function carregar() {
  carregando.value = true; erro.value = '';
  try { dados.value = await api.duplicadosHistoricosPrevia(); }
  catch { erro.value = 'Não foi possível montar a prévia agora.'; }
  finally { carregando.value = false; }
}
async function unificar(item: NonNullable<PreviaDuplicadosHistoricos['itens']>[number]) {
  if (!dados.value || !item.candidato || confirmacao.value.trim().toUpperCase() !== dados.value.confirmacao) return;
  agindo.value = item.legado.id;
  try {
    await api.duplicadosHistoricosUnificar({
      perdedorId: item.legado.id, vencedorId: item.candidato.id,
      codigoPerdedorEsperado: item.legado.codigoInterno, codigoVencedorEsperado: item.candidato.codigoInterno,
      confirmacao: confirmacao.value,
    });
    confirmacao.value = '';
    await carregar();
  } catch (e) { erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não foi possível unificar este par.'; }
  finally { agindo.value = null; }
}
onMounted(carregar);
</script>

<template>
  <v-container fluid class="pa-0">
    <v-alert type="info" variant="tonal" class="mb-5" icon="info">
      Confronto exclusivo: histórico <strong>00001–00428</strong> contra SIA <strong>10000–13126</strong> na BASE.
      Só código de barras único ou nome idêntico liberam unificação. Similaridade é apenas sugestão para revisão.
    </v-alert>
    <v-alert v-if="erro" type="error" closable class="mb-4" @click:close="erro = ''">{{ erro }}</v-alert>
    <v-progress-linear v-if="carregando" indeterminate color="primary" class="mb-5" />
    <template v-else-if="dados">
      <v-row class="mb-2">
        <v-col v-for="(quantidade, chave) in dados.resumo" :key="chave" cols="6" md="3">
          <v-card variant="outlined" class="pa-4 cursor-pointer" @click="tipo = chave as TipoConfrontoHistorico">
            <div class="text-caption text-medium-emphasis">{{ ROTULO[chave as TipoConfrontoHistorico] }}</div>
            <div class="text-h5 font-weight-bold">{{ quantidade }}</div>
          </v-card>
        </v-col>
      </v-row>
      <v-card variant="outlined" class="mb-5 pa-4">
        <div class="font-weight-bold mb-1">Confirmação para unificar um par seguro</div>
        <div class="text-body-2 text-medium-emphasis mb-3">O cadastro histórico é aposentado, auditado e aponta para o cadastro SIA. O código SIA é preservado.</div>
        <v-text-field v-model="confirmacao" :placeholder="dados.confirmacao" label="Digite a frase de confirmação" density="compact" hide-details />
      </v-card>
      <div class="d-flex ga-2 flex-wrap mb-4">
        <v-btn :variant="tipo === 'todos' ? 'flat' : 'tonal'" color="primary" @click="tipo = 'todos'">Todos ({{ dados.itens.length }})</v-btn>
        <v-btn v-for="(_, chave) in dados.resumo" :key="chave" :variant="tipo === chave ? 'flat' : 'tonal'" :color="COR[chave as TipoConfrontoHistorico]" @click="tipo = chave as TipoConfrontoHistorico">{{ ROTULO[chave as TipoConfrontoHistorico] }}</v-btn>
      </div>
      <v-card v-for="item in itens" :key="item.legado.id" variant="outlined" class="mb-3 pa-4">
        <div class="d-flex align-start justify-space-between ga-3 flex-wrap">
          <div>
            <div class="text-caption text-medium-emphasis">Histórico {{ item.legado.codigoInterno }}</div>
            <div class="font-weight-bold">{{ item.legado.nome }}</div>
            <div class="text-caption">Barras: {{ item.legado.codigoBarras || 'não informado' }}</div>
          </div>
          <v-chip :color="COR[item.tipo]" size="small">{{ ROTULO[item.tipo] }}</v-chip>
          <div v-if="item.candidato">
            <div class="text-caption text-medium-emphasis">SIA {{ item.candidato.codigoInterno }}</div>
            <div class="font-weight-bold">{{ item.candidato.nome }}</div>
            <div class="text-caption">Barras: {{ item.candidato.codigoBarras || 'não informado' }}</div>
          </div>
          <div v-else class="text-medium-emphasis">Sem candidato; avalie depois se deve receber o próximo código sequencial acima de {{ dados.tetoAtual }}.</div>
          <v-btn v-if="podeUnificar(item.tipo) && item.candidato" color="primary" :loading="agindo === item.legado.id" :disabled="confirmacao.trim().toUpperCase() !== dados.confirmacao" @click="unificar(item)">Unificar e manter {{ item.candidato.codigoInterno }}</v-btn>
        </div>
      </v-card>
    </template>
  </v-container>
</template>
