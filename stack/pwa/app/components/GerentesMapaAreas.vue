<script setup lang="ts">
import type { ApexOptions } from 'apexcharts';
import type { RelatorioGerentesAreas } from '~/composables/useApi';
type Loja = 'TNP' | 'LI';

const props = defineProps<{ loja: Loja; modo: 'mes' | 'semana' | 'dia'; inicio: string; fim: string }>();
const api = useApi();
const imagemPlanta = ref('');
const erroPlanta = ref('');
let enderecoBlob = '';
async function carregarPlanta() {
  if (props.loja !== 'TNP') return;
  try {
    const imagem = await api.plantaGerentes();
    if (enderecoBlob) URL.revokeObjectURL(enderecoBlob);
    enderecoBlob = URL.createObjectURL(imagem);
    imagemPlanta.value = enderecoBlob;
    erroPlanta.value = '';
  } catch {
    erroPlanta.value = 'Não foi possível carregar a planta para esta conta.';
  }
}
onMounted(carregarPlanta);
watch(() => props.loja, carregarPlanta);
onBeforeUnmount(() => { if (enderecoBlob) URL.revokeObjectURL(enderecoBlob); });

// Nomes da legenda da planta da Unidade Catedral. Tons vizinhos preservam as
// famílias de cor do desenho, mas cada nome é selecionável separadamente.
// O vínculo é do produto cadastrado, independente do PDV onde passou.
const areas = [
  { id: 'caixa', nome: 'Caixa', cor: '#E6A23C', locais: [{ x: 80, y: 27, w: 18, h: 26 }] },
  { id: 'vitrine', nome: 'Vitrine', cor: '#ED6661', locais: [{ x: 66, y: 66, w: 29, h: 24 }] },
  { id: 'copa', nome: 'Copa', cor: '#E5C900', locais: [{ x: 51, y: 66, w: 15, h: 25 }] },
  { id: 'chapa', nome: 'Chapa', cor: '#64C446', locais: [{ x: 25, y: 66, w: 26, h: 25 }] },
  { id: 'mesas', nome: 'Mesas', cor: '#8C2DF4', locais: [{ x: 25, y: 24, w: 54, h: 38 }] },
  { id: 'vasca_paes', nome: 'Vasca pães', cor: '#12B8C7', locais: [{ x: 1, y: 14, w: 6, h: 20 }] },
  { id: 'vitrine_paes', nome: 'Vitrine pães', cor: '#19BFD4', locais: [{ x: 38, y: 2, w: 22, h: 12 }] },
  { id: 'paes_empacotados', nome: 'Pães empacotados', cor: '#51C8D9', locais: [{ x: 18, y: 2, w: 20, h: 12 }] },
  { id: 'mesa_paes', nome: 'Mesa pães', cor: '#6ED4D9', locais: [] },
  { id: 'frios', nome: 'Frios', cor: '#596BD5', locais: [{ x: 1, y: 24, w: 24, h: 30 }] },
  { id: 'bebidas', nome: 'Bebidas', cor: '#4B5ED6', locais: [{ x: 60, y: 2, w: 12, h: 12 }] },
  { id: 'laticinios', nome: 'Laticínios', cor: '#4254C8', locais: [{ x: 72, y: 2, w: 11, h: 12 }] },
  { id: 'mercearia', nome: 'Mercearia', cor: '#3749B8', locais: [{ x: 83, y: 2, w: 12, h: 12 }] },
  { id: 'estoque_bebidas', nome: 'Estoque de bebidas', cor: '#7B8DE8', locais: [{ x: 1, y: 54, w: 15, h: 16 }] },
  { id: 'biscoitos', nome: 'Biscoitos', cor: '#334EC8', locais: [{ x: 1, y: 2, w: 17, h: 12 }] },
  { id: 'dml_limpeza', nome: 'DML / Limpeza', cor: '#64748B', locais: [{ x: 1, y: 71, w: 24, h: 27 }] },
] as const;

const ativas = ref<string[]>(areas.map((area) => area.id));
const todasAtivas = computed(() => ativas.value.length === areas.length);
function alternarTodas() { ativas.value = todasAtivas.value ? [] : areas.map((area) => area.id); }

const dados = ref<RelatorioGerentesAreas | null>(null);
const carregando = ref(false);
const erro = ref('');
let requisicao = 0;
async function carregarDados() {
  const atual = ++requisicao;
  if (props.loja !== 'TNP' || !props.inicio || !props.fim) { dados.value = null; erro.value = ''; return; }
  carregando.value = true;
  erro.value = '';
  try {
    const resposta = await api.relatorioGerentesAreas({
      loja: 'TNP', inicio: props.inicio, fim: props.fim,
      granularidade: props.modo === 'dia' ? 'hora' : 'dia',
    });
    if (atual === requisicao) dados.value = resposta;
  } catch (e: unknown) {
    if (atual === requisicao) {
      dados.value = null;
      erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar a pontuação das áreas.';
    }
  } finally { if (atual === requisicao) carregando.value = false; }
}
onMounted(carregarDados);
watch(() => [props.loja, props.inicio, props.fim, props.modo], carregarDados);

const seriesVisiveis = computed(() => (dados.value?.series ?? []).filter((serie) => ativas.value.includes(serie.area)));
// Como no gráfico por PDV, dias sem movimento não ocupam posições vazias no eixo.
// As horas do modo Dia permanecem completas (06h–22h), mesmo sem venda.
const categoriasGrafico = computed(() => {
  if (!dados.value) return [];
  if (dados.value.granularidade === 'hora') return dados.value.categorias;
  return dados.value.categorias.filter((chave) =>
    seriesVisiveis.value.some((serie) => serie.pontos.some((ponto) => ponto.chave === chave)));
});
const cores = computed(() => seriesVisiveis.value.map((serie) => areas.find((area) => area.id === serie.area)?.cor ?? '#64748B'));
const seriesGrafico = computed(() => seriesVisiveis.value.map((serie) => ({
  name: areas.find((area) => area.id === serie.area)?.nome ?? serie.area,
  data: categoriasGrafico.value.map((chave) => serie.pontos.find((p) => p.chave === chave)?.pontos ?? null),
})));
const pontos = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const moeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nomeCategoria = (chave: string) => chave.endsWith('h') ? chave : `${chave.slice(8, 10)}/${chave.slice(5, 7)}`;
const rotulosCategorias = computed(() => {
  const passo = Math.ceil(categoriasGrafico.value.length / 12);
  return categoriasGrafico.value.map((chave, indice) =>
    indice % passo === 0 ? nomeCategoria(chave) : '');
});
function tooltipArea(serieIndex: number, pontoIndex: number): string {
  const serie = seriesVisiveis.value[serieIndex];
  const chave = categoriasGrafico.value[pontoIndex];
  const ponto = serie?.pontos.find((p) => p.chave === chave);
  if (!serie || !chave || !ponto) return '';
  const area = areas.find((a) => a.id === serie.area);
  const linha = (titulo: string, valor: string) => `<div class="ga-hover-linha"><span>${titulo}</span><strong>${valor}</strong></div>`;
  return `<div class="ga-hover">
    <div class="ga-hover-topo"><i style="background:${area?.cor ?? '#64748B'}"></i><strong>${area?.nome ?? ''}</strong><span>${nomeCategoria(chave)}</span></div>
    ${linha('Pontuação', `${pontos(ponto.pontos)} pts`)}
    ${linha(dados.value?.origem === 'venda_produto_dia' ? 'Faturamento dos produtos' : 'Faturamento dos itens', ponto.faturamento === null ? 'Restrito' : moeda(ponto.faturamento))}
    ${linha('Quantidade vendida', pontos(ponto.quantidade))}
    ${linha('Número de vendas', ponto.numeroVendas === null ? 'Não disponível' : String(ponto.numeroVendas))}
    ${linha('Ticket médio', ponto.ticketMedio === null ? (dados.value?.origem === 'venda_produto_dia' ? 'Não disponível' : 'Restrito') : moeda(ponto.ticketMedio))}
  </div>`;
}
const opcoesGrafico = computed<ApexOptions>(() => ({
  chart: { type: 'bar', stacked: true, toolbar: { show: false }, fontFamily: 'inherit', foreColor: '#667085' },
  colors: cores.value,
  plotOptions: { bar: { borderRadius: 4, columnWidth: '72%' } },
  dataLabels: { enabled: false },
  grid: { borderColor: '#E5E7EB', padding: { left: 8, right: 12 } },
  xaxis: {
    categories: rotulosCategorias.value,
    tickAmount: Math.min(12, categoriasGrafico.value.length),
    labels: { rotate: 0, hideOverlappingLabels: true, style: { colors: '#667085', fontSize: '12px' } },
  },
  yaxis: { min: 0, labels: { formatter: (v) => `${pontos(v)} pts` } },
  legend: { show: false },
  tooltip: { shared: false, intersect: true, custom: ({ seriesIndex, dataPointIndex }) => tooltipArea(seriesIndex, dataPointIndex) },
}));
</script>

<template>
  <div class="ga-layout">
    <section class="ga-card ga-mapa-card" aria-label="Mapa das áreas da loja">
      <div class="ga-heading">
        <span class="ga-icon"><v-icon icon="map" size="23" /></span>
        <div><h2>Mapa da loja</h2><p>Unidade Catedral · selecione as áreas para destacar na planta</p></div>
      </div>
      <v-alert v-if="loja !== 'TNP'" type="info" variant="tonal" class="my-4">A planta fornecida é da TNP. O mapa da LI ainda não foi enviado.</v-alert>
      <template v-else>
        <v-alert v-if="erroPlanta" type="error" variant="tonal" class="my-4">{{ erroPlanta }}</v-alert>
        <template v-if="imagemPlanta">
        <div class="ga-controles">
          <button type="button" class="ga-todas" @click="alternarTodas">{{ todasAtivas ? 'Desmarcar todas' : 'Marcar todas' }}</button>
          <span>{{ ativas.length }} de {{ areas.length }} áreas acesas</span>
        </div>
        <div class="ga-planta">
          <img :src="imagemPlanta" alt="Planta da Unidade Catedral com as áreas identificadas" />
          <template v-for="area in areas" :key="area.id">
            <div v-for="(local, indice) in area.locais" :key="`${area.id}-${indice}`"
              class="ga-local" :class="{ 'ga-local--inativo': !ativas.includes(area.id) }"
              :style="{ left: `${local.x}%`, top: `${local.y}%`, width: `${local.w}%`, height: `${local.h}%`, '--area-cor': area.cor }"
              :title="area.nome" />
          </template>
        </div>
        <p class="ga-mapa-aviso">Bebidas, Laticínios e Mercearia compartilham uma faixa na planta; a divisão visual é aproximada. A atribuição dos pontos vem exclusivamente da área definida no produto.</p>
        <div class="ga-legenda">
          <label v-for="area in areas" :key="area.id" class="ga-area" :class="{ 'ga-area--inativa': !ativas.includes(area.id) }">
            <input v-model="ativas" type="checkbox" :value="area.id" :aria-label="area.nome" />
            <span class="ga-swatch" :style="{ background: area.cor }" />
            <span>{{ area.nome }}<small v-if="!area.locais.length" class="ga-sem-posicao"> · sem posição delimitada</small></span>
          </label>
        </div>
        </template>
      </template>
    </section>

    <section v-if="loja === 'TNP'" class="ga-card ga-grafico-card" aria-label="Pontuação por área">
      <div class="ga-heading">
        <span class="ga-icon"><v-icon icon="bar_chart" size="23" /></span>
        <div><h2>Pontuação por área</h2><p>{{ modo === 'dia' ? 'Horas de 06h a 22h' : modo === 'semana' ? 'Dias da semana, segunda a sábado' : 'Dias do mês' }}</p></div>
      </div>
      <v-progress-linear v-if="carregando" indeterminate color="primary" />
      <v-alert v-if="erro" type="error" variant="tonal">{{ erro }}</v-alert>
      <div v-else-if="!ativas.length" class="ga-grafico-pendente">
        <v-icon icon="filter_alt_off" size="32" />
        <strong>Nenhuma área selecionada</strong>
        <span>Marque pelo menos uma área no mapa para ver suas barras.</span>
      </div>
      <div v-else-if="!carregando && !seriesVisiveis.length" class="ga-grafico-pendente">
        <v-icon icon="link_off" size="32" />
        <strong>Nenhuma venda com área definida neste período</strong>
        <span>Edite os produtos da TNP e selecione “Área da loja”. Vendas sem produto casado ou sem área ficam fora das barras. No modo Dia, o robô também precisa enviar o detalhe horário dos cupons.</span>
      </div>
      <apexchart v-else-if="dados" type="bar" :height="430" :options="opcoesGrafico" :series="seriesGrafico" />
      <div v-if="dados" class="ga-cobertura">
        <span><strong>{{ pontos(dados.totalPontos) }} pts</strong> em {{ dados.origem === 'venda_produto_dia' ? 'vendas por produto' : 'itens de cupons' }}</span>
        <span><strong>{{ pontos(dados.pontosSemArea) }} pts</strong> fora das barras por falta de vínculo/área</span>
        <span v-if="dados.pontosForaHorario"><strong>{{ pontos(dados.pontosForaHorario) }} pts</strong> fora de 06h–22h</span>
        <span v-if="dados.produtosAreaSugerida"><strong>{{ pontos(dados.pontosAreaSugerida) }} pts</strong> em {{ dados.produtosAreaSugerida }} produto(s) com área sugerida pelo grupo</span>
        <span v-if="dados.produtosSemVinculo || dados.produtosSemArea">{{ dados.produtosSemVinculo }} produto(s) sem vínculo; {{ dados.produtosSemArea }} sem área.</span>
      </div>
      <p v-if="dados?.produtosAreaSugerida" class="ga-nota">Áreas sugeridas pelo grupo são provisórias e não alteram o cadastro. A área escolhida manualmente no produto sempre prevalece. Grupos genéricos ou que cabem em mais de um local continuam pendentes.</p>
      <p class="ga-nota" v-if="dados?.origem === 'venda_produto_dia'">Fonte: vendas diárias por produto. Essa fonte não informa hora, número de cupons ou ticket por área; esses indicadores aparecem como indisponíveis. O total do fechamento do caixa é uma fonte distinta e pode divergir.</p>
      <p class="ga-nota" v-else>Fonte: itens de cupons confirmados no ERP, não o fechamento do caixa. A cobertura pode ser parcial. O mesmo cupom pode contar em mais de uma área se tiver produtos de áreas diferentes.</p>
    </section>
  </div>
</template>

<style scoped>
.ga-layout { display: flex; flex-direction: column; gap: 18px; }
.ga-card { min-width: 0; padding: 23px; border: 1px solid var(--cx-line); border-radius: 22px; background: var(--cx-surface); box-shadow: 0 8px 28px rgba(30, 23, 55, .035); }
.ga-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.ga-heading h2 { margin: 0; font-size: 1.15rem; letter-spacing: -.02em; }
.ga-heading p { margin: 3px 0 0; color: var(--cx-ink-soft); font-size: .83rem; }
.ga-icon { display: grid; place-items: center; flex: 0 0 42px; height: 42px; border-radius: 13px; color: var(--cx-brand); background: var(--cx-brand-wash); }
.ga-controles { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; color: var(--cx-ink-soft); font-size: .78rem; }
.ga-todas { color: var(--cx-brand-strong); font-weight: 700; cursor: pointer; }
.ga-todas:focus-visible, .ga-area:focus-within { outline: 2px solid var(--cx-brand); outline-offset: 2px; }
.ga-planta { position: relative; width: min(100%, 1050px); aspect-ratio: 1181 / 930; margin-inline: auto; overflow: hidden; border: 1px solid var(--cx-line); border-radius: 15px; background: #fff; }
.ga-planta img { position: absolute; width: 151.3%; max-width: none; height: 135.8%; left: -29.04%; top: -11.18%; }
.ga-local { position: absolute; z-index: 1; border: 2px solid transparent; border-radius: 8px; pointer-events: none; transition: background .2s, box-shadow .2s; }
.ga-local:not(.ga-local--inativo) { box-shadow: inset 0 0 22px color-mix(in srgb, var(--area-cor) 44%, transparent); }
.ga-local--inativo { background: rgba(255, 255, 255, .76); border-color: #d1d5db; }
.ga-legenda { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; margin-top: 14px; }
.ga-mapa-aviso { margin: 9px 0 0; color: var(--cx-ink-soft); font-size: .72rem; line-height: 1.4; }
.ga-area { display: flex; align-items: center; gap: 8px; min-height: 37px; padding: 6px 8px; border: 1px solid var(--cx-line-soft); border-radius: 10px; cursor: pointer; font-size: .76rem; line-height: 1.25; }
.ga-area input { accent-color: var(--cx-brand); }
.ga-area--inativa { color: var(--cx-ink-soft); background: var(--cx-surface-sunken); }
.ga-swatch { flex: 0 0 10px; height: 10px; border-radius: 50%; }
.ga-sem-posicao { color: var(--cx-ink-soft); }
.ga-grafico-card { display: flex; flex-direction: column; }
.ga-grafico-pendente { flex: 1; min-height: 340px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 25px; border: 1px dashed var(--cx-line); border-radius: 15px; color: var(--cx-ink-soft); text-align: center; }
.ga-grafico-pendente strong { color: var(--cx-ink); }
.ga-grafico-pendente span { max-width: 400px; font-size: .83rem; line-height: 1.5; }
.ga-cobertura { display: flex; flex-wrap: wrap; gap: 7px 15px; padding-top: 14px; color: var(--cx-ink-soft); font-size: .75rem; }
.ga-cobertura strong { color: var(--cx-ink); }
.ga-nota { margin: 18px 0 0; color: var(--cx-ink-soft); font-size: .76rem; line-height: 1.5; }
@media (max-width: 900px) { .ga-legenda { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .ga-card { padding: 17px; } .ga-legenda { grid-template-columns: 1fr; } }
</style>

<style>
.ga-hover { min-width: 245px; padding: 13px 15px; border: 1px solid #e7e8ed; border-radius: 14px; background: #fff; box-shadow: 0 12px 30px rgba(25,31,47,.14); color: #282a32; font-family: inherit; font-size: 12px; line-height: 1.4; }
.ga-hover-topo, .ga-hover-linha { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; }
.ga-hover-topo { border-bottom: 1px solid #edf0f3; margin-bottom: 5px; }
.ga-hover-topo i { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 9px; }
.ga-hover-topo strong { flex: 1; }
.ga-hover-linha span { color: #667085; }
</style>
