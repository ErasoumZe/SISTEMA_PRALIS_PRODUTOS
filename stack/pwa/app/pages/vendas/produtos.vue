<script setup lang="ts">
import { VendasDatas } from '@pralis/shared';
import type { ProdutosUnicos } from '~/composables/useApi';

const api = useApi();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const LOJAS = [
  { value: 'TNP', label: 'TNP' },
  { value: 'LI', label: 'Lisboa' },
] as const;
const ORDENS = [
  { value: 'faturamento', label: 'Faturamento' },
  { value: 'quantidade', label: 'Quantidade' },
  { value: 'nome', label: 'Nome' },
] as const;

const hoje = new Date();
const loja = ref<'TNP' | 'LI'>(user.value?.loja === 'LI' ? 'LI' : 'TNP');
// padrão amplo: a pergunta que originou a tela era de 20 meses
const inicio = ref('2025-01-01');
const fim = ref(VendasDatas.dataLocalISO(hoje));
const busca = ref('');
const ordenar = ref<'faturamento' | 'quantidade' | 'nome'>('faturamento');
const pagina = ref(1);
const porPagina = ref(50);

const dados = ref<ProdutosUnicos | null>(null);
const carregando = ref(false);
const erro = ref('');

const parametros = computed(() => ({
  ...(isAdmin.value ? { loja: loja.value } : {}),
  inicio: inicio.value,
  fim: fim.value,
  ...(busca.value.trim() ? { busca: busca.value.trim() } : {}),
  ordenar: ordenar.value,
}));

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.produtosUnicos({ ...parametros.value, pagina: pagina.value, porPagina: porPagina.value });
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar os produtos do período.';
  } finally {
    carregando.value = false;
  }
}

onMounted(carregar);
watch([loja, inicio, fim, ordenar, porPagina], () => { pagina.value = 1; carregar(); });
watch(pagina, carregar);

/** Busca só dispara quando o usuário para de digitar. */
let debounce: ReturnType<typeof setTimeout> | null = null;
watch(busca, () => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { pagina.value = 1; carregar(); }, 450);
});

const csvUrl = computed(() => api.produtosUnicosCsvUrl(parametros.value as Record<string, string>));
const totalPaginas = computed(() => Math.max(1, Math.ceil((dados.value?.total ?? 0) / porPagina.value)));

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const dia = (d: string) => { const [a, m, x] = d.split('-'); return `${x}/${m}/${a}`; };
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4">
      <v-btn icon="arrow_back" variant="text" to="/vendas" />
      <h1 class="text-h6 font-weight-bold ml-2">Produtos vendidos no período</h1>
    </div>

    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <v-select
        v-if="isAdmin"
        v-model="loja"
        :items="LOJAS"
        item-title="label"
        item-value="value"
        label="Loja"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 160px"
      />
      <v-text-field v-model="inicio" type="date" label="De" variant="outlined" density="compact" hide-details style="max-width: 180px" />
      <v-text-field v-model="fim" type="date" label="Até" variant="outlined" density="compact" hide-details style="max-width: 180px" />
      <v-text-field
        v-model="busca"
        label="Buscar produto"
        prepend-inner-icon="search"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        style="min-width: 200px; max-width: 260px"
      />
      <v-select
        v-model="ordenar"
        :items="ORDENS"
        item-title="label"
        item-value="value"
        label="Ordenar por"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 180px"
      />
      <v-spacer />
      <!-- link direto: o CSV vem do servidor com o período INTEIRO -->
      <v-btn :href="csvUrl" color="primary" variant="flat" prepend-icon="download" :disabled="!dados?.total">
        Exportar Excel
      </v-btn>
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <div v-if="carregando && !dados" class="d-flex justify-center pa-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="dados">
      <!--
        O histórico anterior a 31/08/2026 não tem a identidade do produto no
        ERP. Sem ela, um produto renomeado no PDV aparece duas vezes. Dizer isso
        é o que separa "a lista está errada" de "esse pedaço ainda não tem como".
      -->
      <v-alert v-if="dados.linhasSemIdErp > 0" type="info" variant="tonal" density="compact" class="mb-4">
        {{ num(dados.linhasSemIdErp) }} linha(s) de venda deste período são anteriores à identificação
        por produto do PDV. Nelas, um produto renomeado pode aparecer mais de uma vez.
      </v-alert>

      <v-row class="mb-1">
        <v-col cols="12" sm="4">
          <v-card flat border rounded="lg" class="pa-4">
            <div class="text-caption text-medium-emphasis text-uppercase">Produtos distintos</div>
            <div class="text-h6 font-weight-bold">{{ num(dados.total) }}</div>
          </v-card>
        </v-col>
        <v-col cols="12" sm="4">
          <v-card flat border rounded="lg" class="pa-4">
            <div class="text-caption text-medium-emphasis text-uppercase">Quantidade vendida</div>
            <div class="text-h6 font-weight-bold">{{ num(dados.totalQuantidade) }}</div>
          </v-card>
        </v-col>
        <v-col cols="12" sm="4">
          <v-card flat border rounded="lg" class="pa-4">
            <div class="text-caption text-medium-emphasis text-uppercase">Faturamento</div>
            <div class="text-h6 font-weight-bold">{{ brl(dados.totalFaturamento) }}</div>
          </v-card>
        </v-col>
      </v-row>

      <v-alert v-if="!dados.produtos.length" type="info" variant="tonal" class="mt-4">
        Nenhuma venda registrada nesse período para esta loja.
      </v-alert>

      <v-card v-else flat border rounded="lg" class="pa-2 mt-4">
        <!-- tabela larga rola dentro do card; a página não rola na horizontal -->
        <div style="overflow-x: auto">
          <v-table density="compact">
            <thead>
              <tr>
                <th class="text-left">Código</th>
                <th class="text-left">Produto</th>
                <th class="text-right">Quantidade</th>
                <th class="text-right">Faturamento</th>
                <th class="text-right">Dias</th>
                <th class="text-left">Primeira</th>
                <th class="text-left">Última</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in dados.produtos" :key="`${p.codigo}|${p.produto}`">
                <td class="text-no-wrap">{{ p.codigo || '—' }}</td>
                <td>
                  {{ p.produto }}
                  <!-- renomeado no PDV: matéria-prima da unificação de cadastros -->
                  <v-tooltip v-if="p.nomesDiferentes > 1" location="top">
                    <template #activator="{ props }">
                      <v-chip v-bind="props" size="x-small" color="warning" variant="tonal" class="ml-1">
                        {{ p.nomesDiferentes }} nomes
                      </v-chip>
                    </template>
                    Este produto teve {{ p.nomesDiferentes }} nomes diferentes no período.
                  </v-tooltip>
                </td>
                <td class="text-right">{{ num(p.quantidade) }}</td>
                <td class="text-right font-weight-bold">{{ brl(p.faturamento) }}</td>
                <td class="text-right">{{ num(p.diasComVenda) }}</td>
                <td class="text-no-wrap">{{ dia(p.primeiraVenda) }}</td>
                <td class="text-no-wrap">{{ dia(p.ultimaVenda) }}</td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card>

      <div v-if="totalPaginas > 1" class="d-flex align-center justify-space-between mt-4 flex-wrap ga-2">
        <div class="text-caption text-medium-emphasis">
          {{ num(dados.total) }} produto(s) · página {{ dados.pagina }} de {{ totalPaginas }}
        </div>
        <v-pagination v-model="pagina" :length="totalPaginas" :total-visible="5" density="comfortable" rounded="lg" active-color="primary" />
      </div>
    </template>
  </div>
</template>
