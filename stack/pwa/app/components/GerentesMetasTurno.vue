<script setup lang="ts">
import { VendasFormato } from '@pralis/shared';
import type { MetasTurno } from '~/composables/useApi';
import { COR_META, COR_VENDA } from '~/utils/gerentesCores';

/**
 * Quem busca é a PÁGINA, não este componente: o indicador "Meta semanal" vive
 * fora da aba de metas e precisaria do mesmo dado. Duas buscas da mesma coisa
 * na mesma tela seriam duas verdades esperando divergir.
 */
const props = defineProps<{
  loja: 'TNP' | 'LI';
  inicio: string;
  dados: MetasTurno | null;
  carregando: boolean;
  falha: string;
  /** O painel administrativo nunca aparece para quem apenas consulta as metas. */
  administrador: boolean;
}>();

const emit = defineEmits<{ recarregar: [] }>();

const { gerarMatrizMetas, importarMetasPlanilhaTnp } = useApi();

const gerando = ref(false);
const importando = ref(false);
const vigenciaPlanilha = ref(props.inicio);
const dialogoPlanilha = ref(false);
const confirmarCongelamento = ref(false);
const recado = ref<{ texto: string; tipo: 'success' | 'error' } | null>(null);

const pts = (valor: number) => VendasFormato.pontosComUnidade(valor);
const pct = (fracao: number | null) => (fracao === null ? '—' : `${(fracao * 100).toFixed(1)}%`);
const dia = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

/**
 * Gera a matriz com os três meses anteriores ao período aberto na tela, e a
 * vigência começa no primeiro dia desse período: a matriz passa a valer para o
 * que se está olhando, e não por cima de um mês já cobrado.
 */
async function gerar(previa: boolean) {
  gerando.value = true;
  try {
    const fimRef = new Date(`${props.inicio}T00:00:00Z`);
    fimRef.setUTCDate(0);
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
          + `${pts(resultado.semanaCompleta.total)} em ${resultado.semanaCompleta.dias} dias abertos `
          + `(${pts(resultado.semanaCompleta.manha)} de manhã, ${pts(resultado.semanaCompleta.tarde)} à tarde). `
          + 'Nada foi gravado.',
      };
    } else {
      recado.value = { tipo: 'success', texto: 'Matriz gravada. A meta dos dias já vividos não muda mais.' };
      emit('recarregar');
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

/** A fonte é lida uma vez e os valores ficam congelados por data no Pralis. */
async function importarPlanilha(aplicar: boolean) {
  importando.value = true;
  try {
    const resultado = await importarMetasPlanilhaTnp({
      vigenciaInicio: vigenciaPlanilha.value,
      aplicar,
    });
    recado.value = {
      tipo: 'success',
      texto: aplicar
        ? `${resultado.gravadas} metas congeladas a partir de ${dia(resultado.vigenciaInicio)}. `
          + `${resultado.domingos} domingo(s) ficaram com meta zero.`
        : `Prévia: ${resultado.gravadas} datas a partir de ${dia(resultado.vigenciaInicio)}. `
          + `${resultado.calculadas} calculadas, ${resultado.semReferencia} sem referência e ${resultado.domingos} domingo(s) fechados. Nada foi gravado.`,
    };
    if (aplicar) {
      confirmarCongelamento.value = false;
      dialogoPlanilha.value = false;
      emit('recarregar');
    }
  } catch (e) {
    recado.value = {
      tipo: 'error',
      texto: (e as { data?: { message?: string } })?.data?.message ?? 'Não foi possível ler a planilha de metas.',
    };
  } finally {
    importando.value = false;
  }
}

const cartoes = computed(() => {
  if (!props.dados) return [];
  const { manha, tarde, total } = props.dados.turnos;
  return [
    { chave: 'manha', titulo: 'Turno manhã', legenda: 'caixas com M no nome do operador', turno: manha },
    { chave: 'tarde', titulo: 'Turno tarde', legenda: 'caixas com T no nome do operador', turno: tarde },
    { chave: 'total', titulo: 'Manhã + tarde', legenda: 'o dia inteiro, só caixa', turno: total },
  ];
});

const diasAbertos = computed(() => (props.dados?.dias ?? []).filter((d) => d.aberto));
/** Sem matriz não há meta: mostrar o realizado como "meta atingida" seria mentira. */
const temMeta = computed(() => Boolean(props.dados?.versao)
  || (props.dados?.regra === 'planilha_364_dias'
    && props.dados.fonte.diasSemReferencia.length === 0));
const podeGerarMatriz = computed(() => props.administrador && props.loja === 'LI');
const podeImportarPlanilha = computed(() => props.administrador && props.loja === 'TNP');
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
      <div v-if="podeImportarPlanilha" class="d-flex justify-end mb-4">
        <v-btn size="small" variant="tonal" prepend-icon="settings" @click="dialogoPlanilha = true">
          Configurar metas
        </v-btn>
      </div>

      <v-dialog v-model="dialogoPlanilha" max-width="680">
        <v-card rounded="lg">
          <v-card-title class="text-subtitle-1 font-weight-bold">Atualizar metas TNP pela planilha</v-card-title>
          <v-card-text>
            <p class="text-body-2 mb-4">
              A prévia confere as fórmulas sem gravar nada. Ao congelar, somente as datas a partir da vigência
              escolhida são substituídas; as metas anteriores permanecem congeladas.
            </p>
            <v-text-field
              v-model="vigenciaPlanilha" label="Substituir a partir de" type="date" density="comfortable"
              hide-details :disabled="importando"
            />
          </v-card-text>
          <v-card-actions class="px-6 pb-5">
            <v-spacer />
            <v-btn variant="text" :disabled="importando" @click="dialogoPlanilha = false">Cancelar</v-btn>
            <v-btn variant="tonal" :loading="importando" @click="importarPlanilha(false)">Ver prévia</v-btn>
            <v-btn color="primary" :disabled="importando" @click="confirmarCongelamento = true">Congelar metas</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <v-dialog v-model="confirmarCongelamento" max-width="480" persistent>
        <v-card rounded="lg">
          <v-card-title class="text-subtitle-1 font-weight-bold">Confirmar congelamento</v-card-title>
          <v-card-text>
            As metas de {{ dia(vigenciaPlanilha) }} em diante serão substituídas pelos valores da planilha.
            As datas anteriores não serão alteradas.
          </v-card-text>
          <v-card-actions class="px-6 pb-5">
            <v-spacer />
            <v-btn variant="text" :disabled="importando" @click="confirmarCongelamento = false">Voltar</v-btn>
            <v-btn color="primary" :loading="importando" @click="importarPlanilha(true)">Congelar agora</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
      <!-- Sem matriz a tela diz o que falta, em vez de apresentar venda como meta atingida. -->
      <v-alert v-if="!temMeta" type="info" variant="tonal" class="mb-4" icon="flag">
        <div class="font-weight-medium mb-1">
          {{ dados.regra === 'planilha_364_dias' ? 'Meta do período indisponível' : `Nenhuma matriz de metas gerada para a ${dados.loja}.` }}
        </div>
        <div v-if="dados.regra === 'planilha_364_dias'" class="text-body-2">
          A fonte da planilha está ligada, mas faltam bases históricas para
          {{ dados.fonte.diasSemReferencia.length }} dia(s): {{ dados.fonte.diasSemReferencia.map(dia).join(', ') }}.
          Os cards do período não são exibidos com uma soma parcial. Nenhum zero foi inventado.
        </div>
        <div v-else class="text-body-2">
          A matriz nasce da média ponderada dos três meses anteriores, com 15% por cima e arredondada à centena,
          e aparece aqui em pontos. Veja a prévia antes de gravar: depois de gravada, a meta dos dias já vividos
          não muda mais.
        </div>
        <div v-if="podeGerarMatriz" class="d-flex flex-wrap ga-2 mt-3">
          <v-btn size="small" variant="tonal" :loading="gerando" @click="gerar(true)">Ver prévia</v-btn>
          <v-btn size="small" color="primary" :loading="gerando" @click="gerar(false)">Gerar e gravar</v-btn>
        </div>
        <div v-else-if="dados.regra === 'matriz_tres_meses' && loja === 'LI'" class="text-caption mt-2">Só o administrador gera a matriz.</div>
      </v-alert>

      <template v-else>
        <v-alert v-if="dados.regra === 'matriz_tres_meses' && loja === 'TNP'" type="warning" variant="tonal" class="mb-4">
          A TNP ainda está na regra antiga de três meses. A fonte da planilha ano versus ano não foi configurada nesta API.
        </v-alert>
        <v-alert v-if="dados.fonte.diasSemReferencia.length" type="warning" variant="tonal" class="mb-4">
          {{ dados.fonte.diasSemReferencia.length }} dia(s) sem base histórica para meta:
          {{ dados.fonte.diasSemReferencia.map(dia).join(', ') }}. O total do período cobre apenas os dias com referência.
        </v-alert>
        <v-alert
          v-if="dados.fonte.diasFechamentoIncompleto?.length"
          type="warning" variant="tonal" density="compact" class="mb-4" icon="sync_problem"
        >
          <strong>{{ dados.fonte.diasFechamentoIncompleto.length }} dia(s) com fechamento de caixa incompleto</strong>
          ficaram fora do realizado e do esperado: a divisão em manhã e tarde só existe no fechamento.
          Eles voltam a contar quando o fechamento chegar inteiro.
        </v-alert>
        <v-alert
          v-if="dados.fonte.diasApurados === 0 && !dados.fonte.diasFechamentoIncompleto?.length"
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
              <div>
                <div class="text-subtitle-1 font-weight-bold">{{ cartao.titulo }}</div>
                <div class="text-caption text-medium-emphasis">{{ cartao.legenda }}</div>
              </div>

              <div class="text-caption text-medium-emphasis mt-4">Meta atingida</div>
              <div class="text-h5 font-weight-bold" :style="{ color: COR_VENDA }">
                {{ pts(cartao.turno.realizado) }}
              </div>
              <v-progress-linear
                :model-value="(cartao.turno.ritmo ?? 0) * 100" :max="100" height="8" rounded
                :color="COR_VENDA" bg-color="grey-lighten-2" class="mt-2"
              />
              <div class="d-flex justify-space-between text-caption text-medium-emphasis mt-1">
                <span>realizado</span>
                <span>esperado até aqui: {{ pts(cartao.turno.metaAteAgora) }}</span>
              </div>

              <v-divider class="my-3" />

              <div class="d-flex justify-space-between align-baseline py-1">
                <span class="text-body-2 text-medium-emphasis">Meta objetivo do período</span>
                <span class="font-weight-bold" :style="{ color: COR_META }">{{ pts(cartao.turno.metaPeriodo) }}</span>
              </div>
              <div class="d-flex justify-space-between align-baseline py-1">
                <span class="text-body-2 text-medium-emphasis">Meta projetada no fechamento</span>
                <span class="font-weight-medium">
                  {{ cartao.turno.projecao === null ? '—' : pts(cartao.turno.projecao) }}
                </span>
              </div>
              <div class="d-flex justify-space-between align-baseline py-1">
                <span class="text-body-2 text-medium-emphasis">Diferença até aqui</span>
                <span class="font-weight-bold" :class="cartao.turno.diferenca < 0 ? 'text-error' : 'text-success'">
                  {{ cartao.turno.diferenca >= 0 ? '+ ' : '− ' }}{{ pts(Math.abs(cartao.turno.diferenca)) }}
                </span>
              </div>
              <!--
                O ritmo fecha o card (pedido do José em 06/10/2026). Ele é a
                conclusão de tudo que está acima — no topo, era lido antes de
                se saber de que número ele fala.
              -->
              <div class="d-flex justify-space-between align-center py-1 mt-1">
                <span class="text-body-2 text-medium-emphasis">Ritmo</span>
                <v-chip
                  size="small" variant="tonal" label
                  :color="cartao.turno.ritmo === null ? 'default' : cartao.turno.ritmo >= 1 ? 'success' : 'error'"
                >
                  {{ pct(cartao.turno.ritmo) }} do esperado
                </v-chip>
              </div>
            </v-card>
          </v-col>
        </v-row>

        <div class="d-flex flex-wrap align-center ga-2 mb-4 text-caption text-medium-emphasis">
          <template v-if="dados.regra === 'planilha_364_dias'">
            <v-chip size="x-small" variant="tonal" label>regra ano versus ano</v-chip>
            <span>Base: mesmo dia da semana, 364 dias antes; domingos TNP fechados; tarde fecha a soma dos cards.</span>
          </template>
          <template v-else>
            <v-chip size="x-small" variant="tonal" label>matriz de {{ dia(dados.versao!.vigenciaInicio) }}</v-chip>
            <span>
            +{{ (dados.versao!.crescimento * 100).toFixed(0) }}% sobre a média ponderada de
            {{ dia(dados.versao!.referenciaInicio) }} a {{ dia(dados.versao!.referenciaFim) }},
            arredondada à centena
            </span>
          </template>
          <v-spacer />
          <template v-if="podeGerarMatriz">
            <v-btn size="x-small" variant="text" :loading="gerando" @click="gerar(true)">Prévia de uma matriz nova</v-btn>
            <v-btn size="x-small" variant="text" color="primary" :loading="gerando" @click="gerar(false)">Gerar nova</v-btn>
          </template>
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
                <td class="text-right text-medium-emphasis">{{ pts(linha.referenciaMedia) }}</td>
                <td class="text-right font-weight-medium">{{ pts(linha.meta) }}</td>
                <td class="text-right">{{ pts(linha.metaManha) }}</td>
                <td class="text-right">{{ pts(linha.metaTarde) }}</td>
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
                <th class="text-right">Entregue</th>
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
                <td class="text-right" :class="d.realizado >= d.meta ? 'text-success' : ''">{{ pts(d.realizado) }}</td>
                <td class="text-right text-medium-emphasis">{{ pts(d.meta) }}</td>
                <td class="text-right" :class="d.manha >= d.metaManha ? 'text-success' : ''">{{ pts(d.manha) }}</td>
                <td class="text-right text-medium-emphasis">{{ pts(d.metaManha) }}</td>
                <td class="text-right" :class="d.tarde >= d.metaTarde ? 'text-success' : ''">{{ pts(d.tarde) }}</td>
                <td class="text-right text-medium-emphasis">{{ pts(d.metaTarde) }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </template>
    </template>
  </div>
</template>
