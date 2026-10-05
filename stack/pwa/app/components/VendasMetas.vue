<script setup lang="ts">
import type { MetasTurno } from '~/composables/useApi';
import { COR_META, COR_VENDA } from '~/utils/gerentesCores';

const props = defineProps<{ loja: 'TNP' | 'LI'; inicio: string; fim: string }>();

const { metasTurno, gerarMatrizMetas } = useApi();

const dados = ref<MetasTurno | null>(null);
const carregando = ref(false);
const falha = ref('');
const gerando = ref(false);
/** Resposta do gerar/prévia. Fica na própria aba: não há navegação para o flash sobreviver. */
const recado = ref<{ texto: string; tipo: 'success' | 'error' } | null>(null);

const brl = (valor: number) => valor.toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
});
const pct = (fracao: number | null) => (fracao === null ? '—' : `${(fracao * 100).toFixed(1)}%`);
const dia = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

async function carregar() {
  carregando.value = true;
  falha.value = '';
  try {
    dados.value = await metasTurno({ loja: props.loja, inicio: props.inicio, fim: props.fim });
  } catch (e) {
    dados.value = null;
    falha.value = (e as { data?: { message?: string } })?.data?.message ?? 'Não foi possível carregar as metas.';
  } finally {
    carregando.value = false;
  }
}

onMounted(carregar);
watch(() => [props.loja, props.inicio, props.fim], carregar);

/**
 * Gera a matriz com os três meses anteriores ao período aberto na tela.
 *
 * A vigência começa no primeiro dia do período: a matriz passa a valer para o
 * que se está olhando, e não por cima de um mês já cobrado.
 */
async function gerar(previa: boolean) {
  gerando.value = true;
  try {
    const fimRef = new Date(`${props.inicio}T00:00:00Z`);
    fimRef.setUTCDate(0); // último dia do mês anterior ao período
    const inicioRef = new Date(fimRef);
    inicioRef.setUTCDate(1);
    inicioRef.setUTCMonth(inicioRef.getUTCMonth() - 2);
    const resultado = await gerarMatrizMetas({
      loja: props.loja,
      referenciaInicio: inicioRef.toISOString().slice(0, 10),
      referenciaFim: fimRef.toISOString().slice(0, 10),
      crescimento: 0.15,
      vigenciaInicio: props.inicio,
      previa,
    });
    if (previa) {
      recado.value = {
        tipo: 'success',
        texto: `Prévia sobre ${resultado.referencia.diasConsiderados} dias de referência: semana de `
          + `${brl(resultado.semanaCompleta.total)} em ${resultado.semanaCompleta.dias} dias abertos `
          + `(${brl(resultado.semanaCompleta.manha)} de manhã, ${brl(resultado.semanaCompleta.tarde)} à tarde). `
          + 'Nada foi gravado.',
      };
    } else {
      recado.value = { tipo: 'success', texto: 'Matriz gravada. A meta dos dias já vividos não muda mais.' };
      await carregar();
    }
  } catch (e) {
    recado.value = {
      tipo: 'error',
      texto: (e as { data?: { message?: string } })?.data?.message ?? 'Não foi possível gerar a matriz.',
    };
  } finally {
    gerando.value = false;
  }
}

const cartoes = computed(() => {
  if (!dados.value) return [];
  const { manha, tarde, total } = dados.value.turnos;
  return [
    { chave: 'manha', titulo: 'Turno manhã', legenda: 'caixas com M no nome do operador', turno: manha },
    { chave: 'tarde', titulo: 'Turno tarde', legenda: 'caixas com T no nome do operador', turno: tarde },
    { chave: 'total', titulo: 'Manhã + tarde', legenda: 'o dia inteiro, só caixa', turno: total },
  ];
});

/** Barra do ritmo: 100% é bater o esperado até a última apuração. */
const largura = (ritmo: number | null) => `${Math.min(100, Math.max(0, (ritmo ?? 0) * 100))}%`;

const diasAbertos = computed(() => (dados.value?.dias ?? []).filter((d) => d.aberto));
</script>

<template>
  <div>
    <v-alert v-if="falha" type="warning" variant="tonal" class="mb-4">{{ falha }}</v-alert>
    <v-alert
      v-if="recado" :type="recado.tipo" variant="tonal" density="compact" class="mb-4"
      closable @click:close="recado = null"
    >{{ recado.texto }}</v-alert>

    <div v-if="carregando && !dados" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="dados">
      <!-- Sem matriz, a tela diz o que falta em vez de mostrar meta zerada. -->
      <v-alert v-if="!dados.versao" type="info" variant="tonal" class="mb-4" icon="flag">
        <div class="font-weight-medium mb-1">Nenhuma matriz de metas gerada para a {{ dados.loja }}.</div>
        <div class="text-body-2">
          A matriz nasce da média ponderada dos três meses anteriores, com 15% por cima e arredondada a R$ 100.
          Veja a prévia antes de gravar: depois de gravada, a meta dos dias já vividos não muda mais.
        </div>
        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-btn size="small" variant="tonal" :loading="gerando" @click="gerar(true)">Ver prévia</v-btn>
          <v-btn size="small" color="primary" :loading="gerando" @click="gerar(false)">Gerar e gravar</v-btn>
        </div>
      </v-alert>

      <v-alert
        v-else-if="dados.fonte.diasApurados === 0"
        type="warning" variant="tonal" density="compact" class="mb-4" icon="sync_problem"
      >
        Nenhum fechamento de caixa neste período. A meta aparece, o realizado não — o que falta é dado, não venda.
      </v-alert>

      <v-alert
        v-else-if="dados.fonte.diasSemFechamento.length"
        type="warning" variant="tonal" density="compact" class="mb-4" icon="sync_problem"
      >
        <strong>{{ dados.fonte.diasSemFechamento.length }} dia(s) abertos sem fechamento de caixa</strong>
        até {{ dia(dados.fonte.ultimoDiaApurado!) }}: {{ dados.fonte.diasSemFechamento.map(dia).join(', ') }}.
        Eles não entram no realizado nem no esperado.
      </v-alert>

      <v-row class="mb-1">
        <v-col v-for="cartao in cartoes" :key="cartao.chave" cols="12" md="4">
          <v-card flat border rounded="lg" class="pa-4 h-100">
            <div class="d-flex justify-space-between align-start ga-2">
              <div>
                <div class="text-subtitle-1 font-weight-bold">{{ cartao.titulo }}</div>
                <div class="text-caption text-medium-emphasis">{{ cartao.legenda }}</div>
              </div>
              <v-chip
                size="small" variant="tonal" label
                :color="cartao.turno.ritmo === null ? 'default' : cartao.turno.ritmo >= 1 ? 'success' : 'error'"
              >
                {{ pct(cartao.turno.ritmo) }} do ritmo
              </v-chip>
            </div>

            <div class="text-caption text-medium-emphasis mt-4">Meta atingida</div>
            <div class="text-h5 font-weight-bold" :style="{ color: COR_VENDA }">
              {{ brl(cartao.turno.realizado) }}
            </div>

            <v-progress-linear
              :model-value="(cartao.turno.ritmo ?? 0) * 100" :max="100" height="8" rounded
              :color="COR_VENDA" bg-color="grey-lighten-2" class="mt-2"
            />
            <div class="d-flex justify-space-between text-caption text-medium-emphasis mt-1">
              <span>realizado</span>
              <span>esperado até aqui: {{ brl(cartao.turno.metaAteAgora) }}</span>
            </div>

            <v-divider class="my-3" />

            <div class="d-flex justify-space-between align-baseline py-1">
              <span class="text-body-2 text-medium-emphasis">Meta objetivo do período</span>
              <span class="font-weight-bold" :style="{ color: COR_META }">{{ brl(cartao.turno.metaPeriodo) }}</span>
            </div>
            <div class="d-flex justify-space-between align-baseline py-1">
              <span class="text-body-2 text-medium-emphasis">Meta projetada no fechamento</span>
              <span class="font-weight-medium">
                {{ cartao.turno.projecao === null ? '—' : brl(cartao.turno.projecao) }}
              </span>
            </div>
            <div class="d-flex justify-space-between align-baseline py-1">
              <span class="text-body-2 text-medium-emphasis">Diferença até aqui</span>
              <span
                class="font-weight-bold"
                :class="cartao.turno.diferenca < 0 ? 'text-error' : 'text-success'"
              >
                {{ cartao.turno.diferenca >= 0 ? '+ ' : '− ' }}{{ brl(Math.abs(cartao.turno.diferenca)) }}
              </span>
            </div>
          </v-card>
        </v-col>
      </v-row>

      <div v-if="dados.versao" class="d-flex flex-wrap align-center ga-2 mb-4 text-caption text-medium-emphasis">
        <v-chip size="x-small" variant="tonal" label>
          matriz de {{ dia(dados.versao.vigenciaInicio) }}
        </v-chip>
        <span>
          +{{ (dados.versao.crescimento * 100).toFixed(0) }}% sobre a média ponderada de
          {{ dia(dados.versao.referenciaInicio) }} a {{ dia(dados.versao.referenciaFim) }},
          arredondada a R$ 100
        </span>
        <v-spacer />
        <v-btn size="x-small" variant="text" :loading="gerando" @click="gerar(true)">Prévia de uma matriz nova</v-btn>
        <v-btn size="x-small" variant="text" color="primary" :loading="gerando" @click="gerar(false)">Gerar nova</v-btn>
      </div>

      <v-card v-if="dados.matriz.length" flat border rounded="lg" class="mb-4">
        <v-card-title class="text-subtitle-2">A matriz, dia da semana por dia da semana</v-card-title>
        <v-card-subtitle class="text-caption pb-2">
          Dia da semana sem venda na referência não entra: é assim que domingo fica fora, pelo dado e não por regra escrita.
        </v-card-subtitle>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Dia</th>
              <th class="text-right">Referência</th>
              <th class="text-right">Meta do dia</th>
              <th class="text-right">Manhã</th>
              <th class="text-right">Tarde</th>
              <th class="text-right">% manhã</th>
              <th class="text-right">Dias na média</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="linha in dados.matriz" :key="linha.diaSemana">
              <td>{{ linha.nome }}</td>
              <td class="text-right text-medium-emphasis">{{ brl(linha.referenciaMedia) }}</td>
              <td class="text-right font-weight-medium">{{ brl(linha.meta) }}</td>
              <td class="text-right">{{ brl(linha.metaManha) }}</td>
              <td class="text-right">{{ brl(linha.metaTarde) }}</td>
              <td class="text-right">{{ pct(linha.pctManha) }}</td>
              <td class="text-right" :class="linha.ocorrencias < 4 ? 'text-warning' : 'text-medium-emphasis'">
                {{ linha.ocorrencias }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>

      <v-card v-if="diasAbertos.length" flat border rounded="lg">
        <v-card-title class="text-subtitle-2">Dia a dia do período</v-card-title>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Dia</th>
              <th class="text-right">Venda</th>
              <th class="text-right">Meta</th>
              <th class="text-right">Manhã</th>
              <th class="text-right">Meta M</th>
              <th class="text-right">Tarde</th>
              <th class="text-right">Meta T</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in diasAbertos" :key="d.data">
              <td>{{ d.sigla }} {{ dia(d.data) }}</td>
              <td class="text-right" :class="d.realizado >= d.meta ? 'text-success' : ''">{{ brl(d.realizado) }}</td>
              <td class="text-right text-medium-emphasis">{{ brl(d.meta) }}</td>
              <td class="text-right" :class="d.manha >= d.metaManha ? 'text-success' : ''">{{ brl(d.manha) }}</td>
              <td class="text-right text-medium-emphasis">{{ brl(d.metaManha) }}</td>
              <td class="text-right" :class="d.tarde >= d.metaTarde ? 'text-success' : ''">{{ brl(d.tarde) }}</td>
              <td class="text-right text-medium-emphasis">{{ brl(d.metaTarde) }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </template>
  </div>
</template>
