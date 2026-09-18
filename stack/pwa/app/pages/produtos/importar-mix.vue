<script setup lang="ts">
import type { MotivoPuloMix, PreviaImportacaoMix } from '~/composables/useApi';

/**
 * Traz para a Base os produtos que existem na planilha MIX e ainda não no
 * sistema.
 *
 * A regra que molda a tela: **campo que a planilha não traz entra vazio, e
 * linha sem o mínimo para ser produto não entra**. Por isso o que ela mostra
 * com mais destaque não é quanto vai entrar — é quanto fica de fora e por quê.
 * Um custo ou uma unidade chutados viram preço errado na etiqueta.
 */
const api = useApi();
const flash = useFlash();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const dados = ref<PreviaImportacaoMix | null>(null);
const carregando = ref(false);
const importando = ref(false);
const erro = ref('');
const confirmacao = ref('');

const MOTIVO: Record<MotivoPuloMix, string> = {
  'ja-existe-por-codigo': 'Já cadastrado (mesmo código)',
  'ja-existe-por-barras': 'Já cadastrado (mesmo código de barras)',
  'sem-nome': 'A linha não tem descrição',
  'unidade-desconhecida': 'Unidade que o cadastro não conhece',
  'tipo-desconhecido': 'Sem IPPT: não dá para saber se é revenda ou produção',
  'codigo-invalido': 'Código fora da faixa do PDV',
  'codigo-repetido-na-planilha': 'O mesmo código aparece em duas linhas',
};

const AVISO: Record<Exclude<PreviaImportacaoMix['estado'], 'ok'>, string> = {
  'sem-destino': 'Falta a variável GOOGLE_SHEETS_MIX_SPREADSHEET_ID no ambiente. Sem ela a tela não lê nada — de propósito, para não ler a planilha errada.',
  'sem-coluna': 'O cabeçalho da aba mudou de nome. As colunas são procuradas pelo título, não pela posição.',
  falhou: 'O Google recusou a leitura. Pode ser credencial, permissão ou indisponibilidade. Nada foi criado.',
};

const foraDeTotal = computed(() => Object.values(dados.value?.pular ?? {}).reduce((a, b) => a + b, 0));
const fraseOk = computed(() => confirmacao.value.trim().toUpperCase() === (dados.value?.confirmacao ?? ''));
const motivos = computed(() => (Object.entries(dados.value?.pular ?? {}) as Array<[MotivoPuloMix, number]>)
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1]));

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.importarMixPrevia();
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível montar a prévia.';
  } finally {
    carregando.value = false;
  }
}

onMounted(() => { void carregar(); });

async function importar() {
  if (!fraseOk.value) return;
  importando.value = true;
  try {
    const r = await api.importarMix(confirmacao.value);
    const extras = [
      r.falhas.length ? `${r.falhas.length} falharam` : '',
      r.restantes ? `faltam ${r.restantes} — clique de novo` : '',
    ].filter(Boolean).join('; ');
    flash.value = {
      texto: `${r.criados} produto(s) criado(s)${extras ? `. ${extras}.` : '.'}`,
      tipo: r.falhas.length ? 'warning' : 'success',
    };
    await carregar();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível importar.',
      tipo: 'error',
    };
  } finally {
    importando.value = false;
  }
}
</script>

<template>
  <v-container class="py-6" style="max-width: 1100px">
    <div class="d-flex flex-wrap align-center ga-3 mb-2">
      <div>
        <h1 class="text-h5 mb-1">Importar da planilha</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Cria na Base os produtos que existem na planilha MIX e ainda não no sistema,
          já com o código do PDV.
        </p>
      </div>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">
        Recarregar
      </v-btn>
    </div>

    <v-alert v-if="!isAdmin" type="warning" variant="tonal" class="mb-4">
      Esta tela é restrita ao administrador: ela cria cadastro para a rede inteira.
    </v-alert>

    <v-alert v-else-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <template v-else-if="dados">
      <v-alert v-if="dados.estado !== 'ok'" type="error" variant="tonal" class="mb-4">
        <div class="text-body-2">{{ AVISO[dados.estado] }}</div>
        <div v-if="dados.faltando.length" class="text-body-2 mt-1">
          Colunas não encontradas: {{ dados.faltando.join(', ') }}
        </div>
        <div v-if="dados.erro" class="text-body-2 mt-1 text-medium-emphasis">{{ dados.erro }}</div>
      </v-alert>

      <template v-else>
        <v-alert v-if="dados.truncada" type="warning" variant="tonal" class="mb-4">
          A leitura chegou ao fim da janela configurada — pode haver produto além dela.
          Aumente <code>GOOGLE_SHEETS_MIX_LINHA_FINAL</code> antes de importar, senão
          parte da planilha fica de fora sem aviso.
        </v-alert>

        <v-row dense class="mb-3">
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ dados.importar.toLocaleString('pt-BR') }}</div>
              <div class="text-caption">Entram como cadastro novo</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ foraDeTotal.toLocaleString('pt-BR') }}</div>
              <div class="text-caption">Ficam de fora</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ dados.linhasLidas.toLocaleString('pt-BR') }}</div>
              <div class="text-caption">Linhas lidas</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ dados.loteMaximo }}</div>
              <div class="text-caption">Por vez</div>
            </v-card>
          </v-col>
        </v-row>

        <v-card flat border rounded="lg" class="mb-4">
          <v-card-title class="text-subtitle-1">Quem fica de fora, e por quê</v-card-title>
          <v-list density="compact">
            <v-list-item v-for="[motivo, n] in motivos" :key="motivo">
              <template #prepend>
                <v-chip size="small" variant="tonal" class="mr-3">{{ n.toLocaleString('pt-BR') }}</v-chip>
              </template>
              <v-list-item-title class="text-body-2">{{ MOTIVO[motivo] }}</v-list-item-title>
            </v-list-item>
            <v-list-item v-if="motivos.length === 0">
              <v-list-item-title class="text-body-2 text-medium-emphasis">
                Nenhuma linha ficou de fora.
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>

        <v-alert type="info" variant="tonal" density="compact" class="mb-4">
          O que a planilha não traz entra <strong>vazio</strong>, nunca chutado — e o
          <strong>fiscal não vem daqui</strong>: quem preenche é a carga fiscal, pela
          fonte já aprovada. O <strong>custo</strong> também fica vazio, porque a aba
          tem um por loja e o cadastro da Base vale para a rede.
        </v-alert>

        <v-card v-if="dados.amostra.length" flat border rounded="lg" class="mb-4">
          <v-card-title class="text-subtitle-1">
            Amostra do que entraria ({{ dados.amostra.length }} de {{ dados.importar }})
          </v-card-title>
          <v-list density="compact" lines="two">
            <v-list-item v-for="d in dados.amostra" :key="d.linha">
              <v-list-item-title class="text-body-2">
                <v-chip size="x-small" variant="tonal" class="mr-2">{{ d.codigo }}</v-chip>
                {{ d.nome }}
              </v-list-item-title>
              <v-list-item-subtitle>linha {{ d.linha }} da planilha</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>

        <v-card flat border rounded="lg" class="pa-3">
          <div class="text-body-2 mb-2">
            Importar cria cadastro de verdade. Repetir continua de onde parou — não duplica.
          </div>
          <div class="d-flex flex-wrap align-center ga-3">
            <v-text-field
              v-model="confirmacao"
              :label="`Digite: ${dados.confirmacao}`"
              density="compact" hide-details variant="outlined"
              style="min-width: 340px; max-width: 460px"
            />
            <v-btn
              color="primary"
              :disabled="!fraseOk || dados.importar === 0"
              :loading="importando"
              prepend-icon="library_add"
              @click="importar"
            >
              Importar {{ Math.min(dados.importar, dados.loteMaximo) }}
              <span v-if="dados.importar > dados.loteMaximo" class="ml-1">de {{ dados.importar }}</span>
            </v-btn>
          </div>
        </v-card>
      </template>
    </template>

    <v-skeleton-loader v-else-if="carregando" type="card" class="mt-4" />
  </v-container>
</template>
