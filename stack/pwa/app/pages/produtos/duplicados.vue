<script setup lang="ts">
import type { Duplicados } from '~/composables/useApi';

const api = useApi();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const CATALOGOS = [
  { value: 'BASE', label: 'Geral (Base)' },
  { value: 'TNP', label: 'TNP' },
  { value: 'LI', label: 'Lisboa' },
] as const;

const loja = ref<string>(isAdmin.value ? 'TNP' : (user.value?.loja ?? 'TNP'));
const semelhancaMinima = ref(75);
const dados = ref<Duplicados | null>(null);
const carregando = ref(false);
const erro = ref('');

const MOTIVOS = {
  codigo_barras: { label: 'Mesmo código de barras', cor: 'error' },
  codigo_interno: { label: 'Mesmo código interno', cor: 'warning' },
  nome: { label: 'Nome parecido', cor: 'info' },
  sem_base: { label: 'Sem vínculo com a Base', cor: 'grey' },
} as const;
const filtro = ref<string[]>(['codigo_barras', 'codigo_interno', 'nome']);

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.produtosDuplicados({
      ...(isAdmin.value ? { loja: loja.value } : {}),
      semelhancaMinima: semelhancaMinima.value,
    });
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar o diagnóstico.';
  } finally {
    carregando.value = false;
  }
}

onMounted(carregar);
watch([loja, semelhancaMinima], carregar);

const visiveis = computed(() => (dados.value?.grupos ?? []).filter((g) => filtro.value.includes(g.motivo)));

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const rotuloCampo: Record<string, string> = {
  custo: 'Custo', vVendaPontual: 'V. Venda', ncm: 'NCM',
  cstPisCofins: 'CST', aliquotaSimples: 'Alíq. Simples', nome: 'Nome',
};
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4">
      <v-btn icon="arrow_back" variant="text" to="/" />
      <h1 class="text-h6 font-weight-bold ml-2">Cadastros possivelmente duplicados</h1>
    </div>

    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <v-select
        v-if="isAdmin"
        v-model="loja"
        :items="CATALOGOS"
        item-title="label"
        item-value="value"
        label="Catálogo"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 190px"
      />
      <div style="min-width: 240px">
        <div class="text-caption text-medium-emphasis">Piso de semelhança de nome: {{ semelhancaMinima }}%</div>
        <v-slider v-model="semelhancaMinima" :min="50" :max="100" :step="5" hide-details density="compact" />
      </div>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">Atualizar</v-btn>
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <div v-if="carregando && !dados" class="d-flex justify-center pa-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="dados">
      <!--
        Esta fatia é DIAGNÓSTICO. Não existe botão de fundir aqui de propósito:
        ninguém sabia se eram 12 duplicatas ou 1.200, e esse número é que decide
        se a unificação precisa de ação em lote ou de um modal por vez.
      -->
      <v-alert type="info" variant="tonal" density="compact" class="mb-4">
        Esta tela apenas <strong>mostra</strong>. Nada é alterado aqui.
        {{ num(dados.produtosAnalisados) }} produto(s) analisados no catálogo
        <strong>{{ dados.loja }}</strong>.
      </v-alert>

      <v-row class="mb-1">
        <v-col cols="6" md="3">
          <v-card flat border rounded="lg" class="pa-3">
            <div class="text-caption text-medium-emphasis text-uppercase">Mesmo cód. barras</div>
            <div class="text-h6 font-weight-bold text-error">{{ num(dados.totais.codigoBarras) }}</div>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card flat border rounded="lg" class="pa-3">
            <div class="text-caption text-medium-emphasis text-uppercase">Mesmo cód. interno</div>
            <div class="text-h6 font-weight-bold">{{ num(dados.totais.codigoInterno) }}</div>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card flat border rounded="lg" class="pa-3">
            <div class="text-caption text-medium-emphasis text-uppercase">Nome parecido</div>
            <div class="text-h6 font-weight-bold">{{ num(dados.totais.nome) }}</div>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card flat border rounded="lg" class="pa-3">
            <div class="text-caption text-medium-emphasis text-uppercase">Sem base</div>
            <div class="text-h6 font-weight-bold">{{ num(dados.totais.semBase) }}</div>
          </v-card>
        </v-col>
      </v-row>

      <div class="text-body-2 mb-4">
        <strong>{{ brl(dados.faturamentoEnvolvido) }}</strong> em vendas dos últimos 90 dias passam por
        cadastros duplicados. A lista começa pelo que move mais dinheiro — não pelo que é mais parecido.
      </div>

      <v-chip-group v-model="filtro" multiple column class="mb-3">
        <v-chip v-for="(m, chave) in MOTIVOS" :key="chave" :value="chave" :color="m.cor" variant="tonal" filter size="small">
          {{ m.label }}
        </v-chip>
      </v-chip-group>

      <v-alert v-if="!visiveis.length" type="success" variant="tonal">
        Nenhum cadastro duplicado com os filtros atuais.
      </v-alert>

      <v-card v-for="(g, i) in visiveis" :key="`${g.motivo}-${g.chave}-${i}`" flat border rounded="lg" class="pa-4 mb-3">
        <div class="d-flex align-center flex-wrap ga-2 mb-3">
          <v-chip :color="MOTIVOS[g.motivo].cor" size="small" variant="tonal">{{ MOTIVOS[g.motivo].label }}</v-chip>
          <span v-if="g.semelhanca !== null" class="text-caption text-medium-emphasis">{{ g.semelhanca }}% parecidos</span>
          <span class="text-caption text-medium-emphasis text-truncate" style="max-width: 340px">{{ g.chave }}</span>
          <v-spacer />
          <span class="text-body-2 font-weight-bold">{{ brl(g.faturamento90d) }}</span>
          <span class="text-caption text-medium-emphasis">90 dias</span>
        </div>

        <!--
          "os dados se mantêm já que são iguais" precisa ser CONFERIDO: se o
          custo ou a alíquota diferem, eles não eram iguais.
        -->
        <div v-if="g.camposDiferentes.length" class="mb-3">
          <span class="text-caption text-medium-emphasis">Diferem em:</span>
          <v-chip
            v-for="c in g.camposDiferentes"
            :key="c"
            size="x-small"
            :color="['ncm','cstPisCofins','aliquotaSimples'].includes(c) ? 'error' : 'warning'"
            variant="tonal"
            class="ml-1"
          >{{ rotuloCampo[c] ?? c }}</v-chip>
        </div>

        <v-alert v-if="g.fiscalDiverge" type="error" variant="tonal" density="compact" class="mb-3">
          O <strong>fiscal diverge</strong> entre estes cadastros. Unificar sem decidir qual vale
          poria imposto errado no cupom.
        </v-alert>

        <div style="overflow-x: auto">
          <v-table density="compact">
            <thead>
              <tr>
                <th class="text-left">Produto</th>
                <th class="text-left">Cód. barras</th>
                <th class="text-left">Interno</th>
                <th class="text-right">Custo</th>
                <th class="text-right">V. Venda</th>
                <th class="text-left">NCM</th>
                <th class="text-left">CST</th>
                <th class="text-left">Base</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in g.produtos" :key="p.id">
                <td>
                  <NuxtLink :to="`/produtos/${p.id}`" class="text-primary">{{ p.descricao || p.nome }}</NuxtLink>
                </td>
                <td class="text-no-wrap">{{ p.codigoBarras || '—' }}</td>
                <td class="text-no-wrap">{{ p.codigoInterno || '—' }}</td>
                <td class="text-right">{{ p.custo == null ? '—' : brl(p.custo) }}</td>
                <td class="text-right">{{ p.vVendaPontual == null ? '—' : brl(p.vVendaPontual) }}</td>
                <td class="text-no-wrap">{{ p.ncm || '—' }}</td>
                <td class="text-no-wrap">{{ p.cstPisCofins || '—' }}</td>
                <td>{{ p.temBase ? 'sim' : 'não' }}</td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card>
    </template>
  </div>
</template>
