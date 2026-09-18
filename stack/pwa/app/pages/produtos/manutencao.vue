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

// ---- reconciliação de códigos SIA ----
type PreviaCodigos = Awaited<ReturnType<typeof api.codigosPrevia>>;
const previaCodigos = ref<PreviaCodigos | null>(null);
const conferindoCodigos = ref(false);
const aplicandoCodigos = ref(false);
const confirmacaoCodigos = ref('');
const resultadoCodigos = ref('');

async function conferirCodigos() {
  conferindoCodigos.value = true;
  erro.value = '';
  try { previaCodigos.value = await api.codigosPrevia(); }
  catch (e) { erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui conferir os códigos.'; }
  finally { conferindoCodigos.value = false; }
}

const podeAplicarCodigos = computed(() => !!previaCodigos.value
  && previaCodigos.value.alteracoes > 0
  && confirmacaoCodigos.value.trim().toUpperCase() === previaCodigos.value.confirmacao);

async function aplicarCodigos() {
  if (!podeAplicarCodigos.value) return;
  aplicandoCodigos.value = true;
  erro.value = '';
  try {
    const r = await api.codigosAplicar(confirmacaoCodigos.value);
    resultadoCodigos.value = `${r.aplicadas} código(s) atualizado(s); planilha: ${r.planilha}.`;
    confirmacaoCodigos.value = '';
    await conferirCodigos();
  } catch (e) {
    erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui aplicar os códigos.';
  } finally { aplicandoCodigos.value = false; }
}

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

// ---- carga fiscal ----
/** Como cada estado aparece na lista, em português. */
const NOME_DO_ESTADO: Record<string, string> = {
  completo: 'completo',
  sem_registro: 'nunca classificado',
  nao_classificado: 'nunca classificado',
  parcial: 'parcial (sem registro de ECF)',
  pendente_grupo_invalido: 'grupo fora das regras oficiais',
  pendente_sem_correspondencia: 'sem registro no cadastro de ECF',
  pendente_ambiguo: 'nome ambíguo na fonte',
  pendente_conflito: 'conflito entre fontes',
  pendente_fonte_da_loja: 'sem cadastro de ECF da loja',
  fonte_indisponivel: 'fonte fora do ar',
};

const panorama = ref<Record<string, number> | null>(null);
const rodandoFiscal = ref(false);
const relatorioFiscal = ref<{
  aplicou: boolean; analisados: number;
  alterados: Array<{ nome: string; de: string; para: string; motivo: string }>;
  proximoCursor: string | null;
} | null>(null);

async function carregarPanorama() {
  try {
    panorama.value = await api.fiscalPanorama();
  } catch {
    panorama.value = null;
  }
}

/**
 * `aplicar` é sempre explícito. A conferência vem primeiro na tela porque
 * reescrever fiscal de mil produtos não pode ser o botão mais fácil de clicar.
 */
async function completarFiscal(aplicar: boolean) {
  rodandoFiscal.value = true;
  try {
    relatorioFiscal.value = await api.fiscalBackfill({ aplicar, limite: 200 });
    if (aplicar) await carregarPanorama();
  } catch (e) {
    erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui completar o fiscal.';
  } finally {
    rodandoFiscal.value = false;
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

/**
 * `resgatar` inclui quem já desistiu. Fica num botão SEPARADO de propósito: o
 * reenvio comum é rotina, e insistir com quem estourou o teto é uma decisão —
 * só faz sentido depois de a causa das falhas ter sido corrigida.
 */
async function reenviarAgora(resgatar = false) {
  reenviando.value = true;
  resultadoReenvio.value = '';
  try {
    const r = await api.reenviarAgora(50, resgatar);
    const resgate = r.reanimados ? `${r.reanimados} desistido(s) voltaram à fila. ` : '';
    resultadoReenvio.value = r.tentados === 0
      ? `${resgate}Nada esperando reenvio agora.`
      : `${resgate}${r.sincronizados} de ${r.tentados} foram para a planilha. `
        + `${r.falharam} continuam pendentes.`;
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
  carregarPanorama();
  conferirCodigos();
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
        "Conferir planilha" morava no menu principal e não era aberta no dia a
        dia — virava item ocupando espaço ao lado das telas de trabalho. A tela
        continua existindo inteira; só passou a ser alcançada daqui, que é a
        casa das coisas de bastidor. Nada foi removido.
      -->
      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Conferir planilha</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Compara, produto a produto, o que está no banco com o que está na planilha
            e aponta as diferenças. É só leitura — não corrige nada.
          </p>
          <v-btn variant="tonal" color="primary" prepend-icon="fact_check" to="/produtos/reconciliacao">
            Abrir a conferência
          </v-btn>
        </v-card-text>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Códigos internos SIA</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Cruza a LI pelo EAN exato com o catálogo Compilart e reserva a farofa da TNP como
            <strong>01326</strong>. Duplicidades e ambiguidades ficam bloqueadas para revisão.
          </p>
          <v-btn variant="tonal" prepend-icon="fact_check" :loading="conferindoCodigos" @click="conferirCodigos">
            Conferir códigos
          </v-btn>
          <template v-if="previaCodigos">
            <p class="mt-4 mb-2">
              <strong>{{ previaCodigos.alteracoes }}</strong> alterações seguras;
              {{ previaCodigos.bloqueadosDuplicidade }} bloqueados por duplicidade,
              {{ previaCodigos.ambiguosCatalogo }} ambíguos no Compilart e
              {{ previaCodigos.semCorrespondencia }} sem correspondência.
            </p>
            <v-table v-if="previaCodigos.amostra.length" density="compact" class="mb-3">
              <tbody>
                <tr v-for="a in previaCodigos.amostra" :key="a.id">
                  <td>{{ a.loja }}</td><td>{{ a.nome }}</td><td>{{ a.de }} → {{ a.para }}</td>
                </tr>
              </tbody>
            </v-table>
            <v-text-field
              v-model="confirmacaoCodigos"
              :label="`Digite ${previaCodigos.confirmacao}`"
              density="comfortable"
              class="mb-3"
            />
            <v-btn color="primary" prepend-icon="sync" :disabled="!podeAplicarCodigos" :loading="aplicandoCodigos" @click="aplicarCodigos">
              Aplicar e sincronizar planilha
            </v-btn>
            <p v-if="resultadoCodigos" class="mt-3 mb-0 text-success">{{ resultadoCodigos }}</p>
          </template>
        </v-card-text>
      </v-card>

      <!--
        Carga fiscal: é a pendência que aparece na planilha em vermelho.
      -->
      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Carga fiscal dos produtos</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Busca alíquota, redução, ECF, categoria e CEST no cadastro de ECF e completa
            quem ainda não tem. <strong>Nada é inventado</strong>: produto sem registro
            na fonte fica como pendente, com o motivo.
          </p>

          <div class="d-flex flex-wrap ga-2 mb-4">
            <v-chip
              v-for="(quantos, estado) in (panorama ?? {})"
              :key="estado"
              label
              size="small"
              :color="estado === 'completo' ? 'success' : (String(estado).startsWith('pendente') ? 'error' : 'warning')"
            >
              {{ quantos }} · {{ NOME_DO_ESTADO[String(estado)] ?? estado }}
            </v-chip>
            <span v-if="!panorama" class="text-medium-emphasis">— sem dados ainda</span>
          </div>

          <div class="d-flex flex-wrap ga-3">
            <v-btn variant="tonal" :loading="rodandoFiscal" prepend-icon="search" @click="completarFiscal(false)">
              Conferir (não grava)
            </v-btn>
            <v-btn
              color="primary"
              :loading="rodandoFiscal"
              :disabled="!relatorioFiscal || relatorioFiscal.aplicou || relatorioFiscal.alterados.length === 0"
              prepend-icon="auto_fix_high"
              @click="completarFiscal(true)"
            >
              Completar agora
            </v-btn>
          </div>

          <template v-if="relatorioFiscal">
            <v-divider class="my-4" />
            <p class="mb-2">
              <strong>{{ relatorioFiscal.alterados.length }}</strong>
              de {{ relatorioFiscal.analisados }} analisados
              {{ relatorioFiscal.aplicou ? 'foram atualizados' : 'seriam atualizados' }}.
              <span v-if="relatorioFiscal.proximoCursor" class="text-medium-emphasis">
                Há mais produtos: rode de novo para continuar.
              </span>
            </p>
            <v-table v-if="relatorioFiscal.alterados.length" density="compact">
              <tbody>
                <tr v-for="a in relatorioFiscal.alterados.slice(0, 12)" :key="a.nome">
                  <td>{{ a.nome }}</td>
                  <td class="text-medium-emphasis">{{ NOME_DO_ESTADO[a.para] ?? a.para }}</td>
                </tr>
              </tbody>
            </v-table>
          </template>
        </v-card-text>
      </v-card>

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
              @click="reenviarAgora(false)"
            >
              Reenviar agora
            </v-btn>
            <v-btn
              v-if="fila && fila.desistidos > 0"
              variant="tonal"
              color="error"
              prepend-icon="restart_alt"
              :loading="reenviando"
              @click="reenviarAgora(true)"
            >
              Tentar de novo os {{ fila.desistidos }} desistido(s)
            </v-btn>
          </div>
          <p v-if="fila && fila.desistidos > 0" class="text-body-2 text-medium-emphasis mt-3 mb-0">
            Desistir depois de 8 tentativas pressupõe problema permanente. Quando a causa
            era passageira mas demorou mais que isso — planilha sem permissão, cota
            estourada, aba faltando — os produtos ficam presos aqui. Só clique depois de
            a causa estar corrigida; insistir contra um erro que não cede queima cota à toa.
          </p>
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
