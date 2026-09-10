<script setup lang="ts">
/**
 * Manutenção do catálogo — página separada de propósito.
 *
 * Zerar o catálogo é a ação mais destrutiva do sistema. Ela não pode dividir
 * espaço com "Novo produto" e "Importar": um clique errado ali custa 4.000
 * cadastros. Aqui a pessoa precisa ter vindo até esta página, baixado o backup
 * e digitado a frase — três atos distintos, nenhum acidental.
 */
const api = useApi();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const total = ref<number | null>(null);
const frase = ref('');
const digitado = ref('');
const baixouBackup = ref(false);
const carregando = ref(false);
const executando = ref(false);
const erro = ref('');
const resultado = ref('');

async function carregarPrevia() {
  carregando.value = true;
  erro.value = '';
  try {
    const r = await api.zerarPrevia();
    total.value = r.total;
    frase.value = r.confirmacao;
  } catch (e) {
    erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui ler o total.';
  } finally {
    carregando.value = false;
  }
}

/*
 * O backup é o export que já existe. Marcar que foi baixado é controle de tela,
 * não de servidor — o servidor não tem como saber se o arquivo chegou ao disco.
 * Serve para impedir o caminho apressado, não para ser prova.
 */
function baixarBackup() {
  // link direto, não fetch: é o navegador que salva o arquivo com o nome que o
  // servidor manda — mesmo caminho do CSV de vendas.
  window.open(api.produtosCsvUrl(), '_blank');
  baixouBackup.value = true;
}

const podeZerar = computed(() =>
  isAdmin.value
  && baixouBackup.value
  && total.value !== null
  && total.value > 0
  && digitado.value.trim().toUpperCase() === frase.value);

async function zerar() {
  if (!podeZerar.value || total.value === null) return;
  executando.value = true;
  erro.value = '';
  resultado.value = '';
  try {
    const r = await api.zerarCatalogo(digitado.value, total.value);
    resultado.value = `${r.apagados} produto(s) apagados. O catálogo está vazio — repovoe pela Central de Produtos.`;
    digitado.value = '';
    await carregarPrevia();
  } catch (e) {
    erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui zerar.';
  } finally {
    executando.value = false;
  }
}

// ---- fila de reenvio para a planilha ----
const fila = ref<{ aguardando: number; desistidos: number } | null>(null);
const reenviando = ref(false);
const resultadoReenvio = ref('');

async function carregarFila() {
  try {
    fila.value = await api.reenvioPendentes();
  } catch {
    fila.value = null; // a integração pode estar desligada; não é erro de tela
  }
}

async function reenviarAgora() {
  reenviando.value = true;
  resultadoReenvio.value = '';
  try {
    const r = await api.reenviarAgora();
    resultadoReenvio.value = r.tentados === 0
      ? 'Nada esperando reenvio agora.'
      : `${r.sincronizados} de ${r.tentados} foram para a planilha. ${r.falharam} continuam pendentes.`;
    await carregarFila();
  } catch (e) {
    resultadoReenvio.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui reenviar.';
  } finally {
    reenviando.value = false;
  }
}

onMounted(() => {
  if (!isAdmin.value) return;
  carregarPrevia();
  carregarFila();
});
</script>

<template>
  <v-container class="py-6" style="max-width: 820px">
    <h1 class="text-h5 mb-1">Manutenção do catálogo</h1>
    <p class="text-medium-emphasis mb-6">Ações que não têm volta. Leia antes de clicar.</p>

    <v-alert v-if="!isAdmin" type="error" variant="tonal" class="mb-4">
      Esta página é só do administrador.
    </v-alert>

    <template v-else>
      <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
      <v-alert v-if="resultado" type="success" variant="tonal" class="mb-4">{{ resultado }}</v-alert>

      <!--
        A fila vem ANTES do "zerar": é a ação que se usa toda semana, enquanto
        zerar é a que se usa uma vez. Botão perigoso não fica no topo da página.
      -->
      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Fila de reenvio para a planilha</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Quando o Google falha, o produto fica salvo no banco e a gravação na planilha
            entra nesta fila. O sistema tenta sozinho a cada 5 minutos, esperando mais a
            cada tentativa. Aqui você força a tentativa agora.
          </p>
          <div class="d-flex align-center flex-wrap ga-3">
            <v-chip label :color="fila && fila.aguardando > 0 ? 'warning' : 'success'">
              {{ fila === null ? '—' : fila.aguardando }} aguardando
            </v-chip>
            <v-chip v-if="fila && fila.desistidos > 0" label color="error">
              {{ fila.desistidos }} desistido(s) — precisam de atenção
            </v-chip>
            <v-btn
              variant="tonal"
              prepend-icon="sync"
              :loading="reenviando"
              :disabled="!fila || fila.aguardando === 0"
              @click="reenviarAgora"
            >
              Reenviar agora
            </v-btn>
          </div>
          <p v-if="resultadoReenvio" class="text-medium-emphasis mt-3 mb-0">{{ resultadoReenvio }}</p>
        </v-card-text>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Zerar o catálogo</v-card-title>
        <v-card-text>
          <p class="mb-4">
            Apaga <strong>todos</strong> os produtos do sistema — base e lojas — junto com
            fiscal, promoções e transformação de cada um.
            <strong>A planilha não é tocada</strong>: ela continua sendo a fonte para
            repovoar o catálogo pela Central de Produtos.
          </p>

          <div class="d-flex align-center ga-3 mb-4">
            <v-chip label size="large" :color="total ? 'primary' : undefined">
              <v-progress-circular v-if="carregando" indeterminate size="16" width="2" class="mr-2" />
              {{ total === null ? '—' : total }} produto(s) hoje
            </v-chip>
            <v-btn variant="text" size="small" prepend-icon="refresh" @click="carregarPrevia">Recarregar</v-btn>
          </div>

          <!-- Passo 1: sem backup não há caminho para o passo 2. -->
          <v-btn
            :color="baixouBackup ? 'success' : 'primary'"
            :variant="baixouBackup ? 'tonal' : 'flat'"
            :prepend-icon="baixouBackup ? 'check' : 'download'"
            class="mb-4"
            @click="baixarBackup"
          >
            {{ baixouBackup ? 'Backup baixado' : '1. Baixar backup em CSV' }}
          </v-btn>

          <v-text-field
            v-model="digitado"
            :disabled="!baixouBackup"
            :label="`2. Digite ${frase || 'a frase de confirmação'}`"
            variant="outlined"
            density="comfortable"
            :hint="baixouBackup ? 'Exatamente como está escrito acima.' : 'Baixe o backup primeiro.'"
            persistent-hint
            class="mb-4"
          />

          <v-btn
            color="error"
            :disabled="!podeZerar"
            :loading="executando"
            prepend-icon="delete_forever"
            @click="zerar"
          >
            3. Zerar catálogo
          </v-btn>
        </v-card-text>
      </v-card>

      <v-card variant="outlined">
        <v-card-title class="text-subtitle-1">Depois de zerar</v-card-title>
        <v-card-text>
          O catálogo se repovoa pela
          <NuxtLink to="/produtos/central">Central de Produtos</NuxtLink>, que junta a
          planilha nova com as demais fontes e deixa você decidir o grupo de cada produto.
          Quem entra sem grupo entra como <strong>A CLASSIFICAR</strong> — nunca com regra
          fiscal adivinhada.
        </v-card-text>
      </v-card>
    </template>
  </v-container>
</template>
