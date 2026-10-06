<script setup lang="ts">
/**
 * O que foi vendido no ponto que a pessoa clicou no gráfico.
 *
 * O gráfico responde "quanto esse caixa fez nesse dia"; a pergunta seguinte é
 * sempre "fez do quê". Esta lista é a resposta, na ordem da curva ABC — do que
 * mais sustenta o faturamento para o que menos sustenta.
 *
 * Reusa o mesmo endpoint da curva ABC do Relatório de vendas, com o período
 * encolhido a um dia e o PDV do ponto. Nada de consulta nova: a classificação
 * precisa ser a MESMA das outras telas, senão o mesmo produto apareceria em
 * classes diferentes dependendo de onde se olha.
 *
 * NEM TODO DIA TEM QUEBRA POR CAIXA. Os itens só se ligam ao PDV quando o ERP
 * mandou a chave do dispositivo; em dias mais antigos a fonte é o total diário
 * e o filtro de PDV é ignorado. Quando isso acontece, a lista mostra a loja
 * inteira e diz isso em cima — melhor que uma tela vazia (decisão do José em
 * 06/10/2026).
 */
import { VendasFormato } from '@pralis/shared';
import type { AbcProdutos } from '~/composables/useApi';

const props = defineProps<{
  loja: 'TNP' | 'LI';
  /** Primeiro e último dia do recorte. Iguais quando veio de um ponto. */
  inicio: string;
  fim: string;
  /** O PDV, ou null para todos. O nome do caixa serve: a API aceita os dois. */
  pdv: string | null;
  /** Hora cheia do ponto, quando veio do gráfico por hora (ex.: '14'). */
  hora?: string | null;
}>();
const emit = defineEmits<{ limpar: [] }>();

const api = useApi();
const dados = ref<AbcProdutos | null>(null);
const carregando = ref(false);
const erro = ref('');
let requisicao = 0;

/**
 * Até onde a lista vai, em acumulado.
 *
 * 100 mostra tudo. Baixar o corte responde "quais produtos fazem 80% do dia" —
 * que é a leitura da curva e o motivo de a coluna existir.
 */
const corteAcumulado = ref(100);
const CORTES = [50, 80, 95, 100];

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number) => VendasFormato.formatarPercentual(v);
const qtd = (v: number) => VendasFormato.formatarQuantidade(v);
const rotuloData = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** O servidor avisa quando não soube separar por caixa naquele dia. */
const pdvIgnorado = computed(() => !!props.pdv && (dados.value?.fonte.ignorados ?? []).includes('pdv'));
/** O mesmo aviso para a hora: fonte diária não sabe a que hora vendeu. */
const horaIgnorada = computed(() => !!props.hora && (dados.value?.fonte.ignorados ?? []).includes('hora'));

const itens = computed(() => {
  const lista = dados.value?.itens ?? [];
  if (corteAcumulado.value >= 100) return lista;
  /*
   * Inclui o item que ATRAVESSA o corte: cortar antes dele mostraria 78% com
   * o rótulo de 80%. É o mesmo critério que define a classe A.
   */
  const i = lista.findIndex((item) => item.acumulado >= corteAcumulado.value);
  return i < 0 ? lista : lista.slice(0, i + 1);
});
const faturamentoMostrado = computed(() => itens.value.reduce((soma, i) => soma + i.faturamento, 0));

const umDiaSo = computed(() => props.inicio === props.fim);

async function carregar() {
  const atual = ++requisicao;
  if (!props.inicio || !props.fim) { dados.value = null; return; }
  carregando.value = true;
  erro.value = '';
  try {
    const resposta = await api.vendasCurvaAbc({
      loja: props.loja,
      inicio: props.inicio,
      fim: props.fim,
      ...(props.pdv ? { pdv: props.pdv } : {}),
      // a hora vira a janela fechada daquela hora: 14h = 14:00 até 14:59
      ...(props.hora ? { hi: `${props.hora}:00`, hf: `${props.hora}:59` } : {}),
    });
    if (atual === requisicao) dados.value = resposta;
  } catch (e: unknown) {
    if (atual !== requisicao) return;
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar os produtos deste dia.';
  } finally {
    if (atual === requisicao) carregando.value = false;
  }
}

onMounted(carregar);
watch(() => [props.loja, props.inicio, props.fim, props.pdv, props.hora], carregar);
</script>

<template>
  <v-card flat border rounded="lg" class="pa-4 mt-4">
    <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-4">
      <div class="d-flex align-center ga-3">
        <v-icon icon="inventory_2" size="23" color="primary" />
        <div>
          <div class="text-subtitle-1 font-weight-bold">
            Produtos vendidos
            <template v-if="umDiaSo">em {{ rotuloData(inicio) }}</template>
            <template v-else>de {{ rotuloData(inicio) }} a {{ rotuloData(fim) }}</template>
            <template v-if="hora && !horaIgnorada">, às {{ hora }}h</template>
          </div>
          <div class="text-caption text-medium-emphasis">
            {{ pdv && !pdvIgnorado ? pdv : 'Todos os PDVs' }} · ordenado pela curva ABC
          </div>
        </div>
      </div>
      <!--
        Não "fechar": a lista do período é parte da tela. O botão só desfaz o
        recorte que o clique no ponto criou.
      -->
      <v-btn v-if="umDiaSo || pdv || hora" variant="text" size="small" prepend-icon="undo" @click="emit('limpar')">
        Ver o período inteiro
      </v-btn>
    </div>

    <v-progress-linear v-if="carregando" indeterminate color="primary" class="mb-3" />
    <v-alert v-if="erro" type="error" variant="tonal" density="compact" class="mb-3">{{ erro }}</v-alert>

    <v-alert v-if="pdvIgnorado || horaIgnorada" type="info" variant="tonal" density="compact" class="mb-3">
      Neste dia a fonte é o total diário, sem
      <template v-if="pdvIgnorado && horaIgnorada">quebra por caixa nem por hora</template>
      <template v-else-if="pdvIgnorado">quebra por caixa</template>
      <template v-else>horário</template>:
      a lista mostra <strong>{{ pdvIgnorado ? 'todos os PDVs' : 'o dia inteiro' }}</strong>.
    </v-alert>

    <template v-if="dados && dados.itens.length">
      <div class="d-flex align-center flex-wrap ga-3 mb-3">
        <div class="text-caption text-medium-emphasis">Mostrar até</div>
        <v-btn-toggle v-model="corteAcumulado" mandatory density="compact" variant="outlined" divided rounded="lg">
          <v-btn v-for="c in CORTES" :key="c" :value="c" size="small">{{ c === 100 ? 'Tudo' : `${c}%` }}</v-btn>
        </v-btn-toggle>
        <div class="text-caption text-medium-emphasis">
          {{ itens.length }} de {{ dados.itens.length }} produto(s) · {{ brl(faturamentoMostrado) }}
          <template v-if="!umDiaSo"> · {{ dados.periodo.dias }} dia(s)</template>
        </div>
      </div>

      <div class="gm-produtos-lista">
        <v-table density="compact" fixed-header height="100%">
          <thead>
            <tr>
              <th class="text-left">#</th>
              <th class="text-left">Produto</th>
              <th class="text-right">Total de venda</th>
              <th class="text-right">Faturamento</th>
              <th class="text-right">% do fat.</th>
              <th class="text-right">% acum.</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in itens" :key="`${i.produtoCodigo}-${i.produto}`" :class="{ 'gm-produtos-a': i.classe === 'A' }">
              <td class="text-no-wrap">
                <span class="font-weight-medium">{{ i.posicao }}</span>
                <span class="text-caption text-medium-emphasis ms-1">{{ i.classe }}</span>
              </td>
              <td>
                <div class="text-truncate" style="max-width: 280px">{{ i.produto }}</div>
                <div class="text-caption text-medium-emphasis">{{ i.produtoCodigo || 'sem código' }}</div>
              </td>
              <td class="text-right">{{ qtd(i.quantidade) }}</td>
              <td class="text-right font-weight-bold">{{ brl(i.faturamento) }}</td>
              <td class="text-right">{{ pct(i.participacao) }}</td>
              <td class="text-right text-medium-emphasis">{{ pct(i.acumulado) }}</td>
            </tr>
          </tbody>
        </v-table>
      </div>

      <div class="d-flex align-start ga-2 pt-3 mt-3 text-caption text-medium-emphasis gm-produtos-rodape">
        <v-icon icon="info" size="16" />
        <span>
          <strong>% do fat.</strong> é o peso do produto no faturamento do dia;
          <strong>% acum.</strong> é a soma dessa fatia do primeiro até ele — é por onde se lê
          quantos produtos fazem 80% do dia.
          <template v-if="dados.semCadastro"> {{ dados.semCadastro }} produto(s) vendidos não casaram com o cadastro.</template>
        </span>
      </div>
    </template>

    <div v-else-if="!carregando && !erro" class="d-flex flex-column align-center ga-3 py-8 text-medium-emphasis">
      <v-icon icon="inventory_2" size="34" />
      <span>
        Nenhum item de venda chegou {{ umDiaSo ? 'neste dia' : 'neste período' }}
        <template v-if="pdv"> para {{ pdv }}</template>.
      </span>
    </div>
  </v-card>
</template>

<style scoped>
.gm-produtos-lista { max-height: min(60vh, 460px); overflow: auto; border: 1px solid var(--cx-line-soft); border-radius: 8px; }
.gm-produtos-rodape { border-top: 1px solid var(--cx-line-soft); line-height: 1.5; }
.gm-produtos-a { background: var(--cx-sales-revenue-wash); }
.gm-produtos-a td:first-child { border-left: 3px solid var(--cx-sales-revenue); }
</style>
