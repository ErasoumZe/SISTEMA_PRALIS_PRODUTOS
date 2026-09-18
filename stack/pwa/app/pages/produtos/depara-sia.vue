<script setup lang="ts">
import type { ResumoDePara } from '~/composables/useApi';

/**
 * Importa o de-para do SIA pela tela.
 *
 * Antes isto só existia como `npm run creare:depara`, que precisa de shell e da
 * credencial do banco de produção — ou seja, a régua da numeração da rede
 * dependia de um desenvolvedor com acesso ao servidor, e o catálogo do SIA muda
 * toda semana.
 *
 * Conferir primeiro, gravar depois: substituir o de-para com um arquivo errado
 * manda o produto errado para o PDV.
 */
const api = useApi();
const flash = useFlash();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const LOJAS = ['TNP', 'LI', 'HORA'];
const loja = ref('LI');
const arquivos = ref<File[]>([]);
const resumo = ref<ResumoDePara | null>(null);
const confirmacao = ref('');
const conferindo = ref(false);
const gravando = ref(false);
const erro = ref('');

const arquivo = computed(() => arquivos.value[0] ?? null);
const problemas = computed(() => (resumo.value?.barrasAmbiguas.length ?? 0) + (resumo.value?.coditensRepetidos.length ?? 0));
const podeGravar = computed(() => !!resumo.value
  && problemas.value === 0
  && resumo.value.linhas > 0
  && confirmacao.value.trim().toUpperCase() === resumo.value.confirmacao);

/* Trocar de arquivo ou de loja invalida a conferência: ela era sobre o outro. */
watch([arquivo, loja], () => { resumo.value = null; confirmacao.value = ''; });

async function conferir() {
  if (!arquivo.value) return;
  conferindo.value = true;
  erro.value = '';
  try {
    resumo.value = await api.deParaPrevia(loja.value, arquivo.value);
  } catch (e: unknown) {
    resumo.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não consegui ler o arquivo.';
  } finally {
    conferindo.value = false;
  }
}

async function gravar() {
  if (!podeGravar.value || !arquivo.value) return;
  gravando.value = true;
  erro.value = '';
  try {
    const r = await api.deParaAplicar(loja.value, arquivo.value, confirmacao.value);
    flash.value = {
      texto: `De-para de ${r.loja} substituído: ${r.gravadas} linha(s) no lugar de ${r.substituidas}.`,
      tipo: 'success',
    };
    resumo.value = null;
    confirmacao.value = '';
    arquivos.value = [];
  } catch (e: unknown) {
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não consegui gravar.';
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <v-container class="py-6" style="max-width: 900px">
    <h1 class="text-h5 mb-1">De-para do SIA</h1>
    <p class="text-medium-emphasis mb-6">
      A régua da numeração da rede. É daqui que sai o código de cada produto no PDV.
    </p>

    <v-alert v-if="!isAdmin" type="error" variant="tonal" class="mb-4">
      Esta página é só do administrador.
    </v-alert>

    <template v-else>
      <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

      <v-card flat border rounded="lg" class="pa-4 mb-4">
        <div class="text-body-2 mb-3">
          Exporte o catálogo no <strong>SIA Supervisor</strong> da loja e envie o
          arquivo <code>.xls</code> ou <code>.csv</code> aqui. Cada loja tem a sua
          exportação — a da Lisboa não serve para a TNP.
        </div>
        <v-row dense>
          <v-col cols="12" md="3">
            <v-select v-model="loja" :items="LOJAS" label="Loja" density="compact" variant="outlined" hide-details />
          </v-col>
          <v-col cols="12" md="6">
            <v-file-input
              v-model="arquivos" label="Exportação do SIA" density="compact" variant="outlined"
              accept=".xls,.xlsx,.csv" prepend-icon="" prepend-inner-icon="upload_file" hide-details
            />
          </v-col>
          <v-col cols="12" md="3">
            <v-btn
              block color="primary" variant="tonal" prepend-icon="fact_check"
              :disabled="!arquivo" :loading="conferindo" @click="conferir"
            >
              Conferir
            </v-btn>
          </v-col>
        </v-row>
      </v-card>

      <template v-if="resumo">
        <v-row dense class="mb-3">
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ resumo.linhas.toLocaleString('pt-BR') }}</div>
              <div class="text-caption">Linhas com código de barras</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ resumo.atuais.toLocaleString('pt-BR') }}</div>
              <div class="text-caption">Já cadastradas em {{ resumo.loja }}</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ resumo.semBarras.toLocaleString('pt-BR') }}</div>
              <div class="text-caption">Sem barras — ficam de fora</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-body-1 font-weight-medium">
                {{ resumo.faixa ? `${resumo.faixa.min}–${resumo.faixa.max}` : '—' }}
              </div>
              <div class="text-caption">Faixa de código no arquivo</div>
            </v-card>
          </v-col>
        </v-row>

        <v-alert v-if="problemas" type="error" variant="tonal" class="mb-4">
          <div class="font-weight-medium mb-1">
            {{ problemas }} problema(s) impedem a gravação
          </div>
          <div v-if="resumo.barrasAmbiguas.length" class="text-body-2">
            Código de barras apontando para mais de um produto — um sobrescreveria o outro no PDV:
            <ul class="mt-1">
              <li v-for="a in resumo.barrasAmbiguas" :key="a.chave">
                <code>{{ a.chave }}</code> → {{ a.coditens.join(', ') }}
              </li>
            </ul>
          </div>
          <div v-if="resumo.coditensRepetidos.length" class="text-body-2 mt-2">
            Coditem repetido na exportação: {{ resumo.coditensRepetidos.join(', ') }}
          </div>
        </v-alert>

        <v-alert v-else type="warning" variant="tonal" class="mb-4">
          Gravar <strong>substitui o de-para de {{ resumo.loja }} inteiro</strong> — não mescla.
          A exportação é a verdade daquele momento: o que não está nela sai daqui.
        </v-alert>

        <v-card v-if="!problemas" flat border rounded="lg" class="pa-3">
          <div class="d-flex flex-wrap align-center ga-3">
            <v-text-field
              v-model="confirmacao"
              :label="`Digite: ${resumo.confirmacao}`"
              density="compact" hide-details variant="outlined"
              style="min-width: 360px; max-width: 480px"
            />
            <v-btn color="primary" :disabled="!podeGravar" :loading="gravando" prepend-icon="sync_alt" @click="gravar">
              Substituir o de-para de {{ resumo.loja }}
            </v-btn>
          </div>
        </v-card>
      </template>
    </template>
  </v-container>
</template>
