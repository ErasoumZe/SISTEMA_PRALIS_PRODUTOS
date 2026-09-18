<script setup lang="ts">
import type { MotivoSemCusto, PreviaCustoMer } from '~/composables/useApi';

/**
 * Carga de custo pela base de discriminação de mercadorias.
 *
 * A regra é o DB-05 do backlog: o custo do produto é o da compra **mais
 * recente** nessa base. Cada linha da aba é um lançamento de compra, não um
 * cadastro — o mesmo produto aparece uma vez por nota.
 *
 * Custo alimenta o cálculo do preço de venda, então a tela mostra o valor
 * antigo ao lado do novo antes de gravar: é a diferença entre "atualizei o
 * custo" e "mudei o preço da loja sem perceber".
 */
const api = useApi();
const flash = useFlash();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const dados = ref<PreviaCustoMer | null>(null);
const carregando = ref(false);
const aplicando = ref(false);
const erro = ref('');
const confirmacao = ref('');

const MOTIVO: Record<MotivoSemCusto, string> = {
  'sem-lancamento': 'Sem compra nesta base',
  'ja-esta-certo': 'Já está com o custo da última compra',
  'nome-ambiguo-no-cadastro': 'Dois cadastros com o mesmo nome — não dá para saber de qual é a nota',
  'custo-ilegivel': 'O valor na planilha não é um número',
};

const AVISO: Record<Exclude<PreviaCustoMer['estado'], 'ok'>, string> = {
  'sem-destino': 'Falta a variável GOOGLE_SHEETS_MER_SPREADSHEET_ID no ambiente. Sem ela a tela não lê nada — de propósito, para não ler a planilha errada.',
  'sem-coluna': 'Não encontrei as colunas PRODUTOS, VALOR CUSTO UN e DATA REF nas primeiras linhas da aba. O cabeçalho é procurado, não fixado — mas ele precisa existir.',
  falhou: 'O Google recusou a leitura. Nada foi gravado.',
};

const reais = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fraseOk = computed(() => confirmacao.value.trim().toUpperCase() === (dados.value?.confirmacao ?? ''));
const motivos = computed(() => (Object.entries(dados.value?.semCusto ?? {}) as Array<[MotivoSemCusto, number]>)
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1]));

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.custoMerPrevia();
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível montar a prévia.';
  } finally {
    carregando.value = false;
  }
}

onMounted(() => { void carregar(); });

async function aplicar() {
  if (!fraseOk.value) return;
  aplicando.value = true;
  try {
    const r = await api.custoMerAplicar(confirmacao.value);
    const extras = [
      r.conflitos ? `${r.conflitos} mudaram no meio do caminho` : '',
      r.restantes ? `faltam ${r.restantes} — clique de novo` : '',
    ].filter(Boolean).join('; ');
    flash.value = {
      texto: `${r.aplicados} custo(s) atualizado(s)${extras ? `. ${extras}.` : '.'}`,
      tipo: r.conflitos ? 'warning' : 'success',
    };
    await carregar();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível gravar.',
      tipo: 'error',
    };
  } finally {
    aplicando.value = false;
  }
}
</script>

<template>
  <v-container class="py-6" style="max-width: 1100px">
    <div class="d-flex flex-wrap align-center ga-3 mb-2">
      <div>
        <h1 class="text-h5 mb-1">Custo da discriminação</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Traz para cada produto o valor unitário da <strong>compra mais recente</strong>
          na base de discriminação de mercadorias.
        </p>
      </div>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">
        Recarregar
      </v-btn>
    </div>

    <v-alert v-if="!isAdmin" type="warning" variant="tonal" class="mb-4">
      Esta tela é restrita ao administrador: custo alimenta o preço de venda calculado.
    </v-alert>

    <v-alert v-else-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <template v-else-if="dados">
      <v-alert v-if="dados.estado !== 'ok'" type="error" variant="tonal" class="mb-4">
        <div class="text-body-2">{{ AVISO[dados.estado] }}</div>
        <div v-if="dados.erro" class="text-body-2 mt-1 text-medium-emphasis">{{ dados.erro }}</div>
      </v-alert>

      <template v-else>
        <v-alert v-if="dados.truncada" type="warning" variant="tonal" class="mb-4">
          A leitura chegou ao fim da janela configurada — pode haver lançamento além dela,
          e o mais recente pode estar justamente lá. Aumente
          <code>GOOGLE_SHEETS_MER_LINHA_FINAL</code> antes de gravar.
        </v-alert>

        <v-card flat border rounded="lg" class="pa-3 mb-4">
          <div class="text-body-2 text-medium-emphasis">
            {{ dados.lancamentos.toLocaleString('pt-BR') }} lançamentos lidos
            <span v-if="dados.linhaCabecalho">· cabeçalho encontrado na linha {{ dados.linhaCabecalho }}</span>
            <span v-if="dados.lancamentosDescartados">
              · {{ dados.lancamentosDescartados.toLocaleString('pt-BR') }} linhas sem produto ou sem valor
            </span>
          </div>
        </v-card>

        <v-row dense class="mb-3">
          <v-col cols="6" md="4">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ dados.comCusto.toLocaleString('pt-BR') }}</div>
              <div class="text-caption">Produtos que receberiam custo</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="4">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ (dados.semCusto['ja-esta-certo'] ?? 0).toLocaleString('pt-BR') }}</div>
              <div class="text-caption">Já estão certos</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="4">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ dados.loteMaximo }}</div>
              <div class="text-caption">Por vez</div>
            </v-card>
          </v-col>
        </v-row>

        <v-card flat border rounded="lg" class="mb-4">
          <v-card-title class="text-subtitle-1">Quem não recebe custo, e por quê</v-card-title>
          <v-list density="compact">
            <v-list-item v-for="[motivo, n] in motivos" :key="motivo">
              <template #prepend>
                <v-chip size="small" variant="tonal" class="mr-3">{{ n.toLocaleString('pt-BR') }}</v-chip>
              </template>
              <v-list-item-title class="text-body-2">{{ MOTIVO[motivo] }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>

        <v-card v-if="dados.amostra.length" flat border rounded="lg" class="mb-4">
          <v-card-title class="text-subtitle-1">
            Amostra do que mudaria ({{ dados.amostra.length }} de {{ dados.comCusto }})
          </v-card-title>
          <v-list density="compact" lines="two">
            <v-list-item v-for="p in dados.amostra" :key="p.productId">
              <v-list-item-title class="text-body-2 d-flex flex-wrap align-center ga-2">
                <span class="font-weight-medium">{{ p.nome }}</span>
                <span class="text-medium-emphasis">{{ reais(p.custoAtual) }}</span>
                <v-icon size="small" icon="arrow_forward" />
                <strong>{{ reais(p.custoNovo) }}</strong>
              </v-list-item-title>
              <v-list-item-subtitle>{{ p.fonte }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>

        <v-alert type="info" variant="tonal" density="compact" class="mb-4">
          Isto grava <strong>custo</strong>, não preço. Quem transforma custo em preço de
          venda é o cálculo automático, nos produtos que já estão com ele ligado.
        </v-alert>

        <v-card flat border rounded="lg" class="pa-3">
          <div class="d-flex flex-wrap align-center ga-3">
            <v-text-field
              v-model="confirmacao"
              :label="`Digite: ${dados.confirmacao}`"
              density="compact" hide-details variant="outlined"
              style="min-width: 360px; max-width: 480px"
            />
            <v-btn
              color="primary"
              :disabled="!fraseOk || dados.comCusto === 0"
              :loading="aplicando"
              prepend-icon="payments"
              @click="aplicar"
            >
              Atualizar {{ Math.min(dados.comCusto, dados.loteMaximo) }}
              <span v-if="dados.comCusto > dados.loteMaximo" class="ml-1">de {{ dados.comCusto }}</span>
            </v-btn>
          </div>
        </v-card>
      </template>
    </template>

    <v-skeleton-loader v-else-if="carregando" type="card" class="mt-4" />
  </v-container>
</template>
