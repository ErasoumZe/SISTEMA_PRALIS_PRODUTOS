<script setup lang="ts">
/**
 * A régua que converte reais em pontos.
 *
 * É a configuração mais destrutiva da área de vendas: mudar aqui muda a
 * pontuação de todas as telas, de todo mundo. Por isso a tela faz três coisas
 * que uma tela de configuração comum não faria — diz ONDE o número vai mudar
 * antes de salvar, mostra um EXEMPLO em dinheiro ao lado do campo, e exige
 * uma data de vigência em vez de trocar o passado.
 */
import { FatorPontos } from '@pralis/shared';
import type { FatorPontosResposta, FatorVersao } from '~/composables/useApi';

const api = useApi();
const { user } = useAuth();

const loja = ref<'TNP' | 'LI'>('TNP');
const dados = ref<FatorPontosResposta | null>(null);
const carregando = ref(false);
const erro = ref('');
const aviso = ref('');

/* ---------- o formulário da nova vigência ---------- */
const hoje = new Date().toISOString().slice(0, 10);
const vigenciaInicio = ref(hoje);
const faturamento = ref('0,25');
const ticketMedio = ref('0,25');
const ticketEmPontos = ref(false);
const observacao = ref('');
const salvando = ref(false);
const confirmacao = ref(false);

/** Vírgula é como se digita número aqui; o contrato quer ponto. */
const comoNumero = (texto: string): number => Number(String(texto).trim().replace(',', '.'));
const erroFaturamento = computed(() => FatorPontos.erroDoFator(comoNumero(faturamento.value)));
const erroTicket = computed(() => FatorPontos.erroDoFator(comoNumero(ticketMedio.value)));
const formularioValido = computed(() => !erroFaturamento.value && !erroTicket.value && !!vigenciaInicio.value);

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pts = (v: number) => `${Math.round(v).toLocaleString('pt-BR')} pts`;
const data = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const numero = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/** O exemplo que traduz o fator: "R$ 1.000,00 valem 250 pontos". */
const exemplo = computed(() => {
  const n = comoNumero(faturamento.value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return FatorPontos.exemploDoFator(n);
});

const fatorDeHoje = computed(() => dados.value?.vigenteHoje?.faturamento ?? dados.value?.padrao ?? FatorPontos.FATOR_PADRAO);
const mudanca = computed(() => {
  const novo = comoNumero(faturamento.value);
  if (!Number.isFinite(novo) || novo <= 0) return null;
  const atual = fatorDeHoje.value;
  if (novo === atual) return null;
  return { atual, novo, variacao: ((novo - atual) / atual) * 100 };
});

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.fatorPontos(loja.value);
    // o formulário começa na régua que vale hoje: mexer é editar, não recomeçar
    const vigente = dados.value.vigenteHoje;
    faturamento.value = String(vigente?.faturamento ?? dados.value.padrao).replace('.', ',');
    ticketMedio.value = String(vigente?.ticketMedio ?? dados.value.padrao).replace('.', ',');
    ticketEmPontos.value = vigente?.ticketEmPontos ?? false;
    observacao.value = '';
    vigenciaInicio.value = hoje;
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar a régua de pontos.';
  } finally {
    carregando.value = false;
  }
}

onMounted(carregar);
watch(loja, carregar);

async function salvar() {
  if (!formularioValido.value) return;
  salvando.value = true;
  erro.value = '';
  aviso.value = '';
  try {
    const versao = await api.salvarFatorPontos({
      loja: loja.value,
      vigenciaInicio: vigenciaInicio.value,
      faturamento: comoNumero(faturamento.value),
      ticketMedio: comoNumero(ticketMedio.value),
      ticketEmPontos: ticketEmPontos.value,
      ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
    });
    aviso.value = `Régua de ${versao.loja} valendo a partir de ${data(versao.vigenciaInicio)}.`;
    confirmacao.value = false;
    await carregar();
  } catch (e: unknown) {
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível salvar.';
  } finally {
    salvando.value = false;
  }
}

const apagando = ref<string | null>(null);
async function apagar(versao: FatorVersao) {
  if (!confirm(`Apagar a régua de ${data(versao.vigenciaInicio)}? Os dias cobertos por ela voltam a usar a régua anterior.`)) return;
  apagando.value = versao.id;
  erro.value = '';
  try {
    await api.apagarFatorPontos(versao.id);
    aviso.value = 'Vigência apagada.';
    await carregar();
  } catch (e: unknown) {
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível apagar.';
  } finally {
    apagando.value = null;
  }
}
</script>

<template>
  <div class="regua">
    <div class="d-flex align-center ga-3 mb-5 flex-wrap">
      <span class="regua-icone"><v-icon icon="straighten" size="27" /></span>
      <div>
        <h1 class="text-h5 font-weight-bold">Régua de pontos</h1>
        <div class="text-body-2 text-medium-emphasis">Quanto vale um real em pontos, por loja e a partir de quando</div>
      </div>
      <v-spacer />
      <v-select
        v-model="loja" :items="['TNP', 'LI']" label="Loja" variant="outlined"
        density="comfortable" hide-details style="max-width: 150px"
      />
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
    <v-alert v-if="aviso" type="success" variant="tonal" class="mb-4">{{ aviso }}</v-alert>
    <v-progress-linear v-if="carregando" indeterminate color="primary" class="mb-4" />

    <template v-if="dados">
      <!-- o que vale HOJE, antes de qualquer campo editável -->
      <v-card flat border rounded="lg" class="pa-4 mb-4">
        <div class="text-caption text-medium-emphasis">Valendo hoje em {{ loja }}</div>
        <div class="d-flex align-baseline ga-3 flex-wrap mt-1">
          <div class="text-h4 font-weight-bold">{{ numero(fatorDeHoje) }}</div>
          <div class="text-body-1 text-medium-emphasis">
            ponto por real — {{ brl(1000) }} valem {{ pts(1000 * fatorDeHoje) }}
          </div>
        </div>
        <div class="text-caption text-medium-emphasis mt-2">
          <template v-if="dados.vigenteHoje">
            Desde {{ data(dados.vigenteHoje.vigenciaInicio) }}<template v-if="dados.vigenteHoje.criadoPor">, por {{ dados.vigenteHoje.criadoPor }}</template>.
            <template v-if="dados.vigenteHoje.observacao"> {{ dados.vigenteHoje.observacao }}</template>
          </template>
          <template v-else>
            Nenhuma régua cadastrada: vale o padrão do sistema ({{ numero(dados.padrao) }}).
          </template>
        </div>
      </v-card>

      <!-- onde o número vai mudar: antes de salvar, não depois -->
      <v-card flat border rounded="lg" class="pa-4 mb-4 regua-onde">
        <div class="text-subtitle-2 font-weight-bold mb-2">
          <v-icon icon="warning" size="18" class="me-1" />O que muda quando você salva
        </div>
        <ul class="ps-5 text-body-2">
          <li v-for="onde in dados.ondeSeAplica" :key="onde">{{ onde }}</li>
        </ul>
        <div class="text-caption text-medium-emphasis mt-2">
          A régua de um relatório é a vigente no <strong>primeiro dia</strong> do período consultado.
          Um período que atravessa a troca sai inteiro na régua antiga — assim a soma dos dias
          continua batendo com o total.
        </div>
      </v-card>

      <v-card flat border rounded="lg" class="pa-4 mb-4">
        <div class="text-subtitle-1 font-weight-bold mb-1">Nova vigência</div>
        <div class="text-caption text-medium-emphasis mb-4">
          Salvar duas vezes na mesma data corrige a régua daquele dia; não cria uma segunda.
        </div>

        <v-row dense>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="vigenciaInicio" type="date" label="Vale a partir de"
              variant="outlined" density="comfortable" hide-details
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="faturamento" label="Pontos por real"
              variant="outlined" density="comfortable"
              :error-messages="erroFaturamento ? [erroFaturamento] : []"
              :hint="exemplo ? `${brl(exemplo.reais)} valem ${pts(exemplo.pontos)}` : 'Ex.: 0,25'"
              persistent-hint
            />
          </v-col>
          <v-col cols="12" sm="4">
            <div class="text-caption text-medium-emphasis mb-1">Vale para</div>
            <div class="text-body-2">Faturamento <strong>e</strong> meta</div>
            <div class="text-caption text-medium-emphasis">
              A mesma régua nos dois, de propósito: réguas diferentes fariam
              "quanto falta para a meta" nunca fechar.
            </div>
          </v-col>
        </v-row>

        <v-divider class="my-4" />

        <!--
          O ticket médio fica pronto e desligado: ainda está em discussão se
          ele deve aparecer em reais ou em pontos (José × Rodrigo, 06/10/2026).
        -->
        <div class="d-flex align-center justify-space-between flex-wrap ga-3">
          <div>
            <div class="text-subtitle-2 font-weight-bold">Ticket médio</div>
            <div class="text-caption text-medium-emphasis">
              Hoje o ticket médio aparece em reais. O campo abaixo fica guardado e
              <strong>sem efeito</strong> enquanto a chave estiver desligada.
            </div>
          </div>
          <v-switch
            v-model="ticketEmPontos" color="primary" density="compact" hide-details
            label="Mostrar o ticket médio em pontos"
          />
        </div>
        <v-row dense class="mt-1">
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="ticketMedio" label="Pontos por real do ticket"
              variant="outlined" density="comfortable"
              :disabled="!ticketEmPontos"
              :error-messages="erroTicket ? [erroTicket] : []"
              hint="Guardado mesmo desligado."
              persistent-hint
            />
          </v-col>
          <v-col cols="12" sm="8">
            <v-text-field
              v-model="observacao" label="Observação (opcional)"
              placeholder="Por que esta régua mudou"
              variant="outlined" density="comfortable" hide-details
            />
          </v-col>
        </v-row>

        <v-alert v-if="mudanca" type="warning" variant="tonal" density="compact" class="mt-4">
          A régua sai de <strong>{{ numero(mudanca.atual) }}</strong> para <strong>{{ numero(mudanca.novo) }}</strong>
          ({{ mudanca.variacao > 0 ? '+' : '' }}{{ mudanca.variacao.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) }}%).
          A partir de {{ data(vigenciaInicio) }}, {{ brl(1000) }} passam a valer
          {{ pts(1000 * mudanca.novo) }} em vez de {{ pts(1000 * mudanca.atual) }}.
        </v-alert>

        <div class="d-flex align-center ga-3 mt-4 flex-wrap">
          <v-checkbox
            v-model="confirmacao" density="compact" hide-details
            label="Entendi que isto muda a pontuação de todas as telas a partir dessa data"
          />
          <v-btn
            color="primary" prepend-icon="save" :loading="salvando"
            :disabled="!formularioValido || !confirmacao"
            @click="salvar"
          >
            Salvar régua
          </v-btn>
        </div>
      </v-card>

      <v-card flat border rounded="lg" class="pa-4">
        <div class="text-subtitle-1 font-weight-bold mb-3">Vigências de {{ loja }}</div>
        <div v-if="!dados.versoes.length" class="text-body-2 text-medium-emphasis">
          Nenhuma régua cadastrada ainda. O sistema usa o padrão de {{ numero(dados.padrao) }}.
        </div>
        <div v-else style="overflow-x: auto">
          <v-table density="compact">
            <thead>
              <tr>
                <th class="text-left">Vale a partir de</th>
                <th class="text-right">Pontos por real</th>
                <th class="text-right">Ticket</th>
                <th class="text-left">Quem</th>
                <th class="text-left">Observação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in dados.versoes" :key="v.id" :class="{ 'regua-vigente': v.id === dados.vigenteHoje?.id }">
                <td class="text-no-wrap">
                  {{ data(v.vigenciaInicio) }}
                  <v-chip v-if="v.id === dados.vigenteHoje?.id" size="x-small" color="primary" label class="ms-2">vale hoje</v-chip>
                </td>
                <td class="text-right font-weight-bold">{{ numero(v.faturamento) }}</td>
                <td class="text-right text-medium-emphasis">
                  {{ numero(v.ticketMedio) }}<span v-if="!v.ticketEmPontos"> (desligado)</span>
                </td>
                <td class="text-caption">{{ v.criadoPor ?? '—' }}</td>
                <td class="text-caption">{{ v.observacao ?? '—' }}</td>
                <td class="text-right">
                  <v-btn
                    variant="text" size="small" color="error" prepend-icon="delete"
                    :loading="apagando === v.id" @click="apagar(v)"
                  >
                    Apagar
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card>
    </template>
  </div>
</template>

<style scoped>
.regua { max-width: 1100px; margin: 0 auto; }
.regua-icone {
  display: inline-flex; align-items: center; justify-content: center;
  width: 54px; height: 54px; border-radius: 17px;
  color: var(--cx-brand); background: var(--cx-brand-wash);
}
.regua-onde { background: var(--cx-surface-sunken); }
.regua-vigente { background: var(--cx-brand-wash); }
</style>
