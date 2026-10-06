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
const { user, podeVer } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const total = ref<number | null>(null);
const apagaveis = ref<number | null>(null);
const piloto = ref<{ codigoInterno: string; nome: string } | null>(null);
const frase = ref('');
const digitado = ref('');
const baixouBackup = ref(false);
const carregando = ref(false);
const executando = ref(false);
const erro = ref('');
const resultado = ref('');

// A exportação de pesáveis é uma manutenção incremental: nunca troca o de-para inteiro.
const arquivoPesaveis = ref<File | null>(null);
const previaPesaveis = ref<import('~/composables/useApi').PreviaPesaveisSia | null>(null);
const confirmacaoPesaveis = ref('');
const lendoPesaveis = ref(false);
const aplicandoPesaveis = ref(false);
const resultadoPesaveis = ref('');

async function conferirPesaveis() {
  previaPesaveis.value = null;
  resultadoPesaveis.value = '';
  if (!arquivoPesaveis.value) return;
  lendoPesaveis.value = true;
  erro.value = '';
  try { previaPesaveis.value = await api.pesaveisSiaPrevia(arquivoPesaveis.value); }
  catch (e) { erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui ler a exportação.'; }
  finally { lendoPesaveis.value = false; }
}

async function aplicarPesaveis() {
  if (!arquivoPesaveis.value || !previaPesaveis.value) return;
  aplicandoPesaveis.value = true;
  erro.value = '';
  try {
    const r = await api.pesaveisSiaAplicar(arquivoPesaveis.value, previaPesaveis.value, confirmacaoPesaveis.value);
    resultadoPesaveis.value = `${r.produtosAtualizados} produto(s) e ${r.espelhosAtualizados} vínculo(s) atualizados. Confira o diagnóstico e o próximo TXT antes de importar no SIA.`;
    confirmacaoPesaveis.value = '';
    previaPesaveis.value = null;
  } catch (e) {
    erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui aplicar. Nada foi gravado.';
  } finally { aplicandoPesaveis.value = false; }
}

// Backfill de pesável: classifica quem ainda não tem valor. Lê o cadastro e o
// espelho SIA já gravados — não precisa de arquivo.
const lojaBackfill = ref<'TNP' | 'LI'>('TNP');
const previaBackfill = ref<import('~/composables/useApi').PreviaPesavelBackfill | null>(null);
const confirmacaoBackfill = ref('');
const lendoBackfill = ref(false);
const aplicandoBackfill = ref(false);
const resultadoBackfill = ref('');
// Nos conflitos entre cadastro e espelho SIA: por padrão o lote para. Quem
// acabou de corrigir o cadastro (05/10/2026: 9 produtos) manda valer o
// cadastro, e o espelho é corrigido junto para o gerador não barrar.
const manterCadastroNosConflitos = ref(false);
const politicaConflitos = computed(() => (manterCadastroNosConflitos.value ? 'manterCadastro' : 'bloquear') as const);
const bloqueiaBackfill = computed(() => !!previaBackfill.value
  && (previaBackfill.value.conflitos.length > 0 || previaBackfill.value.espelhoAmbiguo.length > 0));

async function conferirBackfill() {
  previaBackfill.value = null;
  resultadoBackfill.value = '';
  lendoBackfill.value = true;
  erro.value = '';
  try { previaBackfill.value = await api.pesavelBackfillPrevia(lojaBackfill.value, politicaConflitos.value); }
  catch (e) { erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui montar a prévia.'; }
  finally { lendoBackfill.value = false; }
}

async function aplicarBackfill() {
  if (!previaBackfill.value) return;
  aplicandoBackfill.value = true;
  erro.value = '';
  try {
    const r = await api.pesavelBackfillAplicar(lojaBackfill.value, confirmacaoBackfill.value, previaBackfill.value.hashPlano, politicaConflitos.value);
    resultadoBackfill.value = `${r.gravados} produto(s) classificados (${r.porOrigem.espelho} pelo espelho SIA, ${r.porOrigem.padrao} pelo padrão N)`
      + (r.completados ? ` e ${r.completados} completados com tecla/validade` : '')
      + (r.espelhosCorrigidos ? `; ${r.espelhosCorrigidos} espelho(s) SIA corrigidos pelo cadastro` : '')
      + '. Confira o diagnóstico Creare e o próximo TXT antes de importar no SIA.';
    confirmacaoBackfill.value = '';
    previaBackfill.value = null;
  } catch (e) {
    erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui aplicar. Nada foi gravado.';
  } finally { aplicandoBackfill.value = false; }
}

// Todos os ativos pesáveis (06/10/2026): S, tecla 000, validade 5, e o espelho
// SIA acompanha. Diferente do backfill, sobrescreve quem já dizia N — por isso
// a frase é outra e a prévia destaca quantos deixam de ser N.
const lojaPadronizar = ref<'TNP' | 'LI'>('TNP');
const previaPadronizar = ref<import('~/composables/useApi').PreviaPesavelPadronizar | null>(null);
const confirmacaoPadronizar = ref('');
const lendoPadronizar = ref(false);
const aplicandoPadronizar = ref(false);
const resultadoPadronizar = ref('');
// 06/10/2026, segunda decisão: a balança recusou a importação ("código do
// produto deve ficar entre 1 e 999999"). Produto com código de barras próprio
// (EAN de indústria, diferente do código interno) fica N. Ligado por padrão.
const barrasPropriasViramN = ref(true);
const regraBarrasProprias = computed(() => (barrasPropriasViramN.value ? 'naoPesavel' : 'pesavel') as const);

async function conferirPadronizar() {
  previaPadronizar.value = null;
  resultadoPadronizar.value = '';
  lendoPadronizar.value = true;
  erro.value = '';
  try { previaPadronizar.value = await api.pesavelPadronizarPrevia(lojaPadronizar.value, regraBarrasProprias.value); }
  catch (e) { erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui montar a prévia.'; }
  finally { lendoPadronizar.value = false; }
}

async function aplicarPadronizar() {
  if (!previaPadronizar.value) return;
  aplicandoPadronizar.value = true;
  erro.value = '';
  try {
    const r = await api.pesavelPadronizarAplicar(lojaPadronizar.value, confirmacaoPadronizar.value, previaPadronizar.value.hashPlano, regraBarrasProprias.value);
    resultadoPadronizar.value = `${r.paraS} ativo(s) agora são pesáveis com tecla 000 e validade 5`
      + (r.paraN ? ` e ${r.paraN} ficaram N por terem código de barras próprio` : '')
      + ` (${r.invertidos} mudaram de lado, ${r.semValor} não tinham valor)`
      + (r.espelhosCorrigidos ? `; ${r.espelhosCorrigidos} linha(s) do espelho SIA corrigidas` : '')
      + '. Baixe o TXT completo de novo antes de importar no SIA; depois ajuste as exceções produto a produto.';
    confirmacaoPadronizar.value = '';
    previaPadronizar.value = null;
  } catch (e) {
    erro.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não consegui aplicar. Nada foi gravado.';
  } finally { aplicandoPadronizar.value = false; }
}

async function carregarPrevia() {
  carregando.value = true;
  erro.value = '';
  try {
    const r = await api.zerarPrevia();
    total.value = r.total;
    apagaveis.value = r.apagaveis;
    piloto.value = r.piloto;
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
  window.open(api.produtosBackupXlsxUrl(), '_blank');
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
    resultado.value = `${r.apagados} produto(s) apagados. O piloto ${r.preservado.codigoInterno} (${r.preservado.nome}) foi preservado.`;
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

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Pesáveis da TNP · exportação do SIA</v-card-title>
        <v-card-text>
          <p class="mb-3">Atualiza somente os itens marcados <strong>S</strong> no SIA, pelo código interno: Pesável = Sim, Tecla = 000 e Validade em dias (inclusive 0). Não transforma os demais em Não nem substitui o de-para inteiro.</p>
          <v-alert type="warning" variant="tonal" density="compact" class="mb-3">Antes de aplicar, pause a tarefa Download TXT SIA TNP no PC da padaria. Após aplicar, confira o diagnóstico e o TXT novo antes da importação manual no SIA.</v-alert>
          <v-file-input v-model="arquivoPesaveis" label="Exportação .xls/.xlsx do SIA" accept=".xls,.xlsx" variant="outlined" density="comfortable" prepend-icon="upload_file" @update:model-value="previaPesaveis = null" />
          <v-btn :disabled="!arquivoPesaveis" :loading="lendoPesaveis" variant="tonal" prepend-icon="fact_check" @click="conferirPesaveis">Conferir sem gravar</v-btn>
          <v-alert v-if="resultadoPesaveis" type="success" variant="tonal" class="mt-3">{{ resultadoPesaveis }}</v-alert>
          <template v-if="previaPesaveis">
            <v-divider class="my-4" />
            <p><strong>{{ previaPesaveis.pesaveisFonte }}</strong> pesáveis em {{ previaPesaveis.totalFonte }} produtos; {{ previaPesaveis.validadeZero }} com validade 0.</p>
            <p>{{ previaPesaveis.atualizarProdutos }} produtos e {{ previaPesaveis.atualizarEspelhos }} vínculos seriam atualizados; {{ previaPesaveis.jaCorretos }} já corretos.</p>
            <p v-if="previaPesaveis.semProduto.length" class="text-warning">{{ previaPesaveis.semProduto.length }} códigos sem produto TNP: {{ previaPesaveis.semProduto.slice(0, 15).join(', ') }}. Esses não serão alterados.</p>
            <p v-if="previaPesaveis.semEspelho.length" class="text-medium-emphasis">{{ previaPesaveis.semEspelho.length }} sem de-para: o cadastro do produto pode ser atualizado, mas o vínculo ausente não será criado.</p>
            <v-alert v-if="previaPesaveis.codigoAmbiguo.length || previaPesaveis.espelhoAmbiguo.length" type="error" variant="tonal" class="my-3">Há códigos ambíguos. A aplicação fica bloqueada até corrigir os vínculos.</v-alert>
            <template v-if="previaPesaveis.amostra.length">
              <p class="mt-3 mb-1 text-medium-emphasis">Amostra do que será gravado:</p>
              <ul class="ps-5">
                <li v-for="item in previaPesaveis.amostra" :key="item.codigoInterno">
                  {{ item.codigoInterno }} · {{ item.nome }} · validade {{ item.validadeDias }} dia(s)
                </li>
              </ul>
            </template>
            <v-text-field v-model="confirmacaoPesaveis" :label="`Digite ${previaPesaveis.confirmacao}`" variant="outlined" class="mt-3" />
            <v-btn color="primary" prepend-icon="save" :loading="aplicandoPesaveis" :disabled="confirmacaoPesaveis.trim().toUpperCase() !== previaPesaveis.confirmacao || !!previaPesaveis.codigoAmbiguo.length || !!previaPesaveis.espelhoAmbiguo.length" @click="aplicarPesaveis">Aplicar somente os pesáveis</v-btn>
          </template>
        </v-card-text>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Classificar pesável · quem ainda não tem valor</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Produto sem <strong>Pesável</strong> no cadastro <strong>e</strong> no espelho SIA não sai no TXT
            (em 05/10/2026 eram 6.823 de 7.177 na TNP). Esta ação classifica quem está em branco: copia o
            espelho SIA quando ele diz; quando ninguém diz, aplica <strong>N</strong> — o mesmo padrão de produto novo.
            Quem já tem valor fica como está.
          </p>
          <v-alert type="info" variant="tonal" density="compact" class="mb-3">
            Faça isto <strong>depois</strong> de reimportar o de-para do SIA: quanto mais o espelho souber, menos produto
            cai no padrão. Conflito entre cadastro e espelho bloqueia tudo até ser resolvido.
          </v-alert>
          <div class="d-flex flex-wrap ga-3 align-center">
            <v-select v-model="lojaBackfill" :items="['TNP', 'LI']" label="Loja" variant="outlined" density="comfortable" hide-details style="max-width: 160px" @update:model-value="previaBackfill = null" />
            <v-btn :loading="lendoBackfill" variant="tonal" prepend-icon="fact_check" @click="conferirBackfill">Conferir sem gravar</v-btn>
          </div>
          <v-checkbox v-model="manterCadastroNosConflitos" density="compact" hide-details class="mt-2"
            label="Nos conflitos, vale o cadastro: o espelho SIA é corrigido para concordar (use só se você acabou de acertar esses produtos no Pralis)"
            @update:model-value="previaBackfill = null" />
          <v-alert v-if="resultadoBackfill" type="success" variant="tonal" class="mt-3">{{ resultadoBackfill }}</v-alert>
          <template v-if="previaBackfill">
            <v-divider class="my-4" />
            <p><strong>{{ previaBackfill.gravar }}</strong> de {{ previaBackfill.totalProdutos }} produtos receberiam pesável:
              {{ previaBackfill.porOrigem.espelho }} pelo espelho SIA, {{ previaBackfill.porOrigem.padrao }} pelo padrão N.</p>
            <p v-if="previaBackfill.completarBalanca">{{ previaBackfill.completarBalanca }} já eram S e ganham tecla/validade do espelho.</p>
            <p class="text-medium-emphasis">{{ previaBackfill.jaDefinidos }} já definidos, intocados.</p>
            <p v-if="previaBackfill.espelhoIncompleto.length" class="text-medium-emphasis">
              {{ previaBackfill.espelhoIncompleto.length }} com espelho S sem tecla/validade ficam de fora — o de-para completo resolve.
            </p>
            <v-alert v-if="bloqueiaBackfill" type="error" variant="tonal" class="my-3">
              <div v-if="previaBackfill.conflitos.length">
                <strong>{{ previaBackfill.conflitos.length }} conflito(s)</strong> entre cadastro e espelho:
                <ul class="ps-5 mt-1">
                  <li v-for="c in previaBackfill.conflitos.slice(0, 10)" :key="c.codigoInterno">
                    {{ c.codigoInterno }} · {{ c.nome }} — cadastro {{ c.cadastro }}, espelho {{ c.espelho }}
                  </li>
                </ul>
              </div>
              <div v-if="previaBackfill.espelhoAmbiguo.length">Espelho ambíguo: {{ previaBackfill.espelhoAmbiguo.slice(0, 10).join(', ') }}</div>
              A aplicação fica bloqueada até resolver.
            </v-alert>
            <v-alert v-if="previaBackfill.espelhoCorrigir.length" type="warning" variant="tonal" class="my-3">
              <strong>{{ previaBackfill.espelhoCorrigir.length }} conflito(s)</strong> resolvidos pelo cadastro — o espelho SIA passa a dizer o mesmo:
              <ul class="ps-5 mt-1">
                <li v-for="c in previaBackfill.espelhoCorrigir.slice(0, 10)" :key="c.espelhoId">
                  {{ c.codigoInterno }} · {{ c.nome }} — fica {{ c.pesavel }}, tecla {{ c.teclaBalanca }}, validade {{ c.validadeBalanca }} dia(s)
                </li>
              </ul>
            </v-alert>
            <template v-if="previaBackfill.amostraPesaveis.length">
              <p class="mt-3 mb-1 text-medium-emphasis">Amostra dos que viram S pelo espelho:</p>
              <ul class="ps-5">
                <li v-for="item in previaBackfill.amostraPesaveis" :key="item.codigoInterno">
                  {{ item.codigoInterno }} · {{ item.nome }} · validade {{ item.validadeDias }} dia(s)
                </li>
              </ul>
            </template>
            <v-text-field v-model="confirmacaoBackfill" :label="`Digite ${previaBackfill.confirmacao}`" variant="outlined" class="mt-3" />
            <v-btn color="primary" prepend-icon="save" :loading="aplicandoBackfill"
              :disabled="confirmacaoBackfill.trim().toUpperCase() !== previaBackfill.confirmacao || bloqueiaBackfill || previaBackfill.gravar + previaBackfill.completarBalanca + previaBackfill.espelhoCorrigir.length === 0"
              @click="aplicarBackfill">Classificar</v-btn>
          </template>
        </v-card-text>
      </v-card>

      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Todos os ativos pesáveis · S, tecla 000, validade 5</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Em 06/10/2026 o TXT entrou no SIA com produto <strong>não pesável</strong>. Decisão: todo produto
            <strong>ativo</strong> da loja vira <strong>Pesável S</strong>, tecla <strong>000</strong> e validade
            <strong>5 dias</strong>, e o espelho SIA passa a dizer o mesmo. Depois você ajusta as exceções
            produto a produto, em Editar. Inativos e unificados não são tocados.
          </p>
          <v-alert type="warning" variant="tonal" density="compact" class="mb-3">
            Isto <strong>sobrescreve</strong> quem já dizia N. É o oposto do cartão acima, que respeita o cadastro.
            Confira a prévia: o número que importa é quantos deixam de ser N.
          </v-alert>
          <div class="d-flex flex-wrap ga-3 align-center">
            <v-select v-model="lojaPadronizar" :items="['TNP', 'LI']" label="Loja" variant="outlined" density="comfortable" hide-details style="max-width: 160px" @update:model-value="previaPadronizar = null" />
            <v-btn :loading="lendoPadronizar" variant="tonal" prepend-icon="fact_check" @click="conferirPadronizar">Conferir sem gravar</v-btn>
          </div>
          <v-checkbox v-model="barrasPropriasViramN" density="compact" hide-details class="mt-2"
            label="Quem tem código de barras próprio (diferente do código interno) fica N: a balança não aceita código acima de 999999. Barras de balança (começam com 2) continuam S."
            @update:model-value="previaPadronizar = null" />
          <v-alert v-if="resultadoPadronizar" type="success" variant="tonal" class="mt-3">{{ resultadoPadronizar }}</v-alert>
          <template v-if="previaPadronizar">
            <v-divider class="my-4" />
            <p><strong>{{ previaPadronizar.gravar }}</strong> de {{ previaPadronizar.totalAtivos }} ativos mudam:
              <strong>{{ previaPadronizar.paraS }}</strong> para S, tecla 000, validade 5<template v-if="previaPadronizar.opcoes.barrasProprias === 'naoPesavel'">,
              <strong>{{ previaPadronizar.paraN }}</strong> para N por terem código de barras próprio</template>.
              {{ previaPadronizar.invertidos }} mudam de lado, {{ previaPadronizar.semValor }} não tinham valor.</p>
            <p class="text-medium-emphasis">{{ previaPadronizar.jaNoPadrao }} já estavam no padrão, intocados.
              {{ previaPadronizar.barrasProprias }} ativos têm código de barras próprio.</p>
            <p>Espelho SIA: <strong>{{ previaPadronizar.espelhoCorrigir }}</strong> linha(s) corrigidas,
              {{ previaPadronizar.espelhoJaNoPadrao }} já diziam isso, {{ previaPadronizar.semEspelho }} ativos sem espelho.</p>
            <template v-if="previaPadronizar.amostraNaoPesaveis.length">
              <p class="mt-3 mb-1 text-medium-emphasis">Amostra dos que ficam N (barras próprias):</p>
              <ul class="ps-5">
                <li v-for="item in previaPadronizar.amostraNaoPesaveis" :key="'n' + item.codigoInterno + item.nome">
                  {{ item.codigoInterno }} · {{ item.nome }} · barras {{ item.codigoBarras }}
                </li>
              </ul>
            </template>
            <template v-if="previaPadronizar.amostraInvertidos.length">
              <p class="mt-3 mb-1 text-medium-emphasis">Amostra dos que deixam de ser N:</p>
              <ul class="ps-5">
                <li v-for="item in previaPadronizar.amostraInvertidos" :key="item.codigoInterno + item.nome">
                  {{ item.codigoInterno }} · {{ item.nome }}
                </li>
              </ul>
            </template>
            <v-text-field v-model="confirmacaoPadronizar" :label="`Digite ${previaPadronizar.confirmacao}`" variant="outlined" class="mt-3" />
            <v-btn color="primary" prepend-icon="save" :loading="aplicandoPadronizar"
              :disabled="confirmacaoPadronizar.trim().toUpperCase() !== previaPadronizar.confirmacao || previaPadronizar.gravar + previaPadronizar.espelhoCorrigir === 0"
              @click="aplicarPadronizar">Padronizar pesável</v-btn>
          </template>
        </v-card-text>
      </v-card>

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
          <v-btn v-if="podeVer('conferir-planilha')" variant="tonal" color="primary" prepend-icon="fact_check" to="/produtos/reconciliacao">
            Abrir a conferência
          </v-btn>
        </v-card-text>

      <!--
        De-para do SIA: é a régua da numeração, e antes só dava para trocar por
        linha de comando com acesso ao banco. Fica ANTES do código de cadastro
        na ordem de uso — sem de-para, aquela tela não tem o que propor.
      -->
      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">De-para do SIA</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Envia a exportação do SIA Supervisor de uma loja e substitui o de-para dela.
            <strong>Confere antes de gravar</strong>: código de barras apontando para dois
            produtos é recusado, porque um sobrescreveria o outro no PDV.
          </p>
          <v-btn v-if="podeVer('depara-sia')" variant="tonal" color="primary" prepend-icon="sync_alt" to="/produtos/depara-sia">
            Abrir o de-para
          </v-btn>
        </v-card-text>
      </v-card>
      </v-card>

      <!--
        Código de cadastro: a numeração que a rede usa mora na planilha MIX, não
        aqui. Esta tela adota o código de lá e só cria número novo para o que
        realmente não existe — uma decisão por clique, porque cunhar não tem volta.
      -->
      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Código de cadastro</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Confronta o código interno de cada produto com o <strong>COD INTERNO</strong>
            da planilha MIX. Adota sozinho só quando o código de barras casa com uma
            linha só; o resto fica para você decidir item a item.
          </p>
          <v-btn v-if="podeVer('giulia-sia')" variant="tonal" color="primary" prepend-icon="barcode" to="/produtos/giulia-sia" class="mr-2">
            Giulia × SIA
          </v-btn>
          <v-btn v-if="podeVer('codigo-cadastro')" variant="tonal" color="primary" prepend-icon="pin" to="/produtos/codigo-cadastro">
            Abrir a reconciliação
          </v-btn>
        </v-card-text>
      </v-card>

      <!--
        Importar da planilha: cria o que existe lá e não aqui. Fica DEPOIS da
        reconciliação de propósito — importar antes de alinhar os códigos criaria
        cadastro novo para produto que já existe com outro número.
      -->
      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Importar da planilha</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Traz para a Base os produtos que existem na planilha MIX e ainda não no
            sistema, já com o código do PDV. <strong>Nada é chutado</strong>: campo que
            a planilha não traz entra vazio, e linha sem o mínimo para ser produto
            fica de fora com o motivo à vista.
          </p>
          <v-btn v-if="podeVer('importar-mix')" variant="tonal" color="primary" prepend-icon="library_add" to="/produtos/importar-mix">
            Abrir a importação
          </v-btn>
        </v-card-text>

      <!--
        Custo: vem da base de discriminação, pela regra do DB-05 (compra mais
        recente). Fica DEPOIS da importação — produto que ainda não existe não
        tem onde receber custo.
      -->
      <v-card variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">Custo da discriminação</v-card-title>
        <v-card-text>
          <p class="mb-3">
            Traz para cada produto o valor unitário da <strong>compra mais recente</strong>
            na base de discriminação de mercadorias. Mostra o custo antigo ao lado do novo
            antes de gravar — custo alimenta o preço de venda calculado.
          </p>
          <v-btn v-if="podeVer('custo-discriminacao')" variant="tonal" color="primary" prepend-icon="payments" to="/produtos/custo-discriminacao">
            Abrir a carga de custo
          </v-btn>
        </v-card-text>
      </v-card>
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
            Apaga todos os produtos do sistema, exceto o piloto Base <strong>13125</strong>, junto com
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

          <v-alert v-if="piloto" type="warning" variant="tonal" density="compact" class="mb-4">
            Serão removidos {{ apagaveis }} produto(s). Será preservado somente {{ piloto.codigoInterno }} — {{ piloto.nome }}.
          </v-alert>

          <!-- Passo 1: sem backup não há caminho para o passo 2. -->
          <v-btn
            :color="baixouBackup ? 'success' : 'primary'"
            :variant="baixouBackup ? 'tonal' : 'flat'"
            :prepend-icon="baixouBackup ? 'check' : 'download'"
            class="mb-4"
            @click="baixarBackup"
          >
            {{ baixouBackup ? 'Backup XLSX baixado' : '1. Baixar backup completo em XLSX' }}
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
            3. Limpar e manter 13125
          </v-btn>
        </v-card-text>
      </v-card>

      <v-card variant="outlined">
        <v-card-title class="text-subtitle-1">Depois de zerar</v-card-title>
        <v-card-text>
          O catálogo se repovoa pela
          <NuxtLink v-if="podeVer('central-de-produtos')" to="/produtos/central">Central de Produtos</NuxtLink><span v-else>Central de Produtos</span>, que junta a
          planilha nova com as demais fontes e deixa você decidir o grupo de cada produto.
          Quem entra sem grupo entra como <strong>A CLASSIFICAR</strong> — nunca com regra
          fiscal adivinhada.
        </v-card-text>
      </v-card>
    </template>
  </v-container>
</template>
