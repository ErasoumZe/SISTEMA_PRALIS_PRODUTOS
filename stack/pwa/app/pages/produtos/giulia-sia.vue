<script setup lang="ts">
import type { PreviaGiuliaSia } from '~/composables/useApi';
const api = useApi(); const flash = useFlash();
const dados = ref<PreviaGiuliaSia | null>(null); const erro = ref(''); const carregando = ref(false); const aplicando = ref(false); const confirmacao = ref(''); const busca = ref('');
const fraseOk = computed(() => confirmacao.value.trim().toUpperCase() === (dados.value?.confirmacao ?? ''));
const resumoCards = computed(() => dados.value ? [
  ['No SIA', dados.value.resumo['conciliar-sia']], ['Novos', dados.value.resumo['novo-codigo']],
  ['Pendentes', dados.value.resumo.pendente], ['Conflitos', dados.value.resumo['conflito-sia']],
] : [] as Array<[string, number]>);
const itens = computed(() => { const t = busca.value.trim().toLowerCase(); return (dados.value?.propostas ?? []).filter((p) => !t || [p.produto.nome, p.produto.codigoBarras, p.codigoProposto, p.situacao].some((v) => String(v ?? '').toLowerCase().includes(t))); });
async function carregar() { carregando.value = true; erro.value = ''; try { dados.value = await api.giuliaSiaPrevia(); } catch (e: any) { erro.value = e?.data?.message ?? 'Não foi possível carregar a prévia.'; } finally { carregando.value = false; } }
async function aplicar() { if (!fraseOk.value) return; aplicando.value = true; try { const r = await api.giuliaSiaAplicar(confirmacao.value); flash.value = { texto: `${r.aplicadas} código(s) aplicados.${r.restantes ? ` Faltam ${r.restantes}.` : ''}`, tipo: 'success' }; confirmacao.value = ''; await carregar(); } catch (e: any) { flash.value = { texto: e?.data?.message ?? 'Não foi possível aplicar.', tipo: 'error' }; } finally { aplicando.value = false; } }
onMounted(() => { void carregar(); });
</script>

<template>
  <v-container fluid class="pa-4 pa-md-6">
    <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-4"><div><h1 class="text-h5">Giulia × SIA</h1><p class="text-body-2 text-medium-emphasis">Conciliação exclusiva por código de barras. Nome e código antigo não são usados.</p></div><v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">Atualizar</v-btn></div>
    <v-alert type="info" variant="tonal" class="mb-4">Só uma barra válida (EAN-8 ou maior) encontrada em um único código do SIA pode conciliar. Sem barra válida, o item fica pendente.</v-alert>
    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
    <template v-if="dados">
      <v-row class="mb-2"><v-col v-for="item in resumoCards" :key="item[0]" cols="6" md="3"><v-card variant="outlined"><v-card-text><div class="text-caption">{{ item[0] }}</div><div class="text-h5">{{ item[1] }}</div></v-card-text></v-card></v-col></v-row>
      <v-card variant="outlined" class="mb-4"><v-card-text><div class="text-body-2 mb-3">Último ativo no SIA: <strong>{{ dados.ultimoSiaAtivo }}</strong> · Maior já usado na base: <strong>{{ dados.maiorBanco }}</strong> · Sequência protegida a partir de: <strong>{{ dados.teto + 1 }}</strong></div><v-text-field v-model="confirmacao" :label="`Digite ${dados.confirmacao} para aplicar os pares seguros`" density="compact" hide-details class="mb-3" /><v-btn color="primary" :disabled="!fraseOk" :loading="aplicando" @click="aplicar">Aplicar conciliações e novos códigos</v-btn></v-card-text></v-card>
      <v-text-field v-model="busca" prepend-inner-icon="search" label="Buscar por nome, barras ou código" density="comfortable" variant="outlined" class="mb-3" />
      <v-card variant="outlined"><v-table density="comfortable"><thead><tr><th>Produto</th><th>Barras</th><th>Atual</th><th>Proposto</th><th>Situação</th><th>Motivo</th></tr></thead><tbody><tr v-for="item in itens" :key="item.produto.id"><td>{{ item.produto.nome }}</td><td>{{ item.produto.codigoBarras || '—' }}</td><td>{{ item.produto.codigoInterno || '—' }}</td><td>{{ item.codigoProposto || '—' }}</td><td><v-chip size="small" :color="item.situacao === 'conciliar-sia' ? 'success' : item.situacao === 'novo-codigo' ? 'warning' : 'error'">{{ item.situacao }}</v-chip></td><td>{{ item.motivo }}</td></tr></tbody></v-table></v-card>
    </template>
  </v-container>
</template>
