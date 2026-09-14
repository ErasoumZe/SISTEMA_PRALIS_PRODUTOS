<script setup lang="ts">
import type { ApexOptions } from 'apexcharts';
import { VendasDatas } from '@pralis/shared';
import type { VendasReport } from '~/composables/useApi';

const api = useApi();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

/** Lojas com relatório nesta etapa. A HORA usa outro PDV e está fora. */
const LOJAS = [
  { value: 'TNP', label: 'TNP' },
  { value: 'LI', label: 'Lisboa' },
] as const;

// data pelo relógio LOCAL: toISOString() converte para UTC e, das 21h em
// diante em Brasília, abriria o filtro com o dia seguinte.
const hoje = new Date();
const iso = VendasDatas.dataLocalISO;

const loja = ref<'TNP' | 'LI'>(
  user.value?.loja === 'LI' ? 'LI' : 'TNP',
);
const inicio = ref(iso(VendasDatas.diasAntes(hoje, 29)));
const fim = ref(iso(hoje));

const dados = ref<VendasReport | null>(null);
const carregando = ref(false);
const erro = ref('');

/** Aba visível. As três dividem o MESMO período — o filtro fica acima delas. */
const aba = ref<'visao' | 'relatorios' | 'graficos'>('visao');

/**
 * Atalhos de período.
 *
 * Existem porque digitar duas datas para ver "esta semana" é trabalho que o
 * sistema pode fazer. O valor fica visível: o botão só acende quando as duas
 * datas batem exatamente com ele, então ninguém confunde atalho com filtro.
 */
const ATALHOS = [
  { dias: 6, label: '7 dias' },
  { dias: 29, label: '30 dias' },
  { dias: 89, label: '90 dias' },
] as const;

function aplicarAtalho(dias: number) {
  inicio.value = iso(VendasDatas.diasAntes(hoje, dias));
  fim.value = iso(hoje);
}

const atalhoAtivo = computed(() =>
  ATALHOS.find((a) => inicio.value === iso(VendasDatas.diasAntes(hoje, a.dias)) && fim.value === iso(hoje))?.dias ?? null);

async function carregar() {
  if (inicio.value > fim.value) {
    erro.value = 'A data inicial precisa ser anterior à final.';
    dados.value = null;
    return;
  }
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.vendasReport({
      // usuário de loja não manda `loja`: quem decide é o servidor
      ...(isAdmin.value ? { loja: loja.value } : {}),
      inicio: inicio.value,
      fim: fim.value,
    });
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar o relatório.';
  } finally {
    carregando.value = false;
  }
}

onMounted(carregar);
watch([loja, inicio, fim], carregar);

const semMovimento = computed(() =>
  !!dados.value && dados.value.resumo.faturamento === 0 && dados.value.resumo.numeroVendas === 0);

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const dia = (d: string) => {
  const [a, m, x] = d.split('-');
  return `${x}/${m}/${a}`;
};
const diaCurto = (d: string) => {
  const [, m, x] = d.split('-');
  return `${x}/${m}`;
};
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const resumoCards = computed(() => {
  const r = dados.value?.resumo;
  if (!r) return [];
  // A origem fica escrita no card: faturamento e quantidade vêm das VENDAS por
  // produto; número de vendas e ticket vêm do FECHAMENTO de caixa. São duas
  // fontes e podem divergir — sem dizer isso, o usuário lê como erro de conta.
  return [
    { label: 'Faturamento', origem: 'vendas por produto', valor: brl(r.faturamento), icon: 'payments', cor: '#6515DD' },
    { label: 'Quantidade vendida', origem: 'vendas por produto', valor: num(r.quantidade), icon: 'inventory_2', cor: '#3B82F6' },
    { label: 'Nº de vendas', origem: 'fechamento de caixa', valor: num(r.numeroVendas), icon: 'receipt_long', cor: '#35128C' },
    { label: 'Ticket médio', origem: 'fechamento de caixa', valor: brl(r.ticketMedio), icon: 'trending_up', cor: '#34A853' },
  ];
});

/** As 12 formas + OUTROS, na ordem em que a operação pensa. */
const COLUNAS_PAGAMENTO = [
  { chave: 'dinheiro', label: 'Dinheiro' },
  { chave: 'pix', label: 'Pix' },
  { chave: 'debito', label: 'Débito' },
  { chave: 'credito', label: 'Crédito' },
  { chave: 'voucher', label: 'Voucher' },
  { chave: 'clientes', label: 'Clientes' },
  { chave: 'crediario', label: 'Crediário' },
  { chave: 'colaboradores', label: 'Colaboradores' },
  { chave: 'alimentacao', label: 'Alimentação' },
  { chave: 'socios', label: 'Sócios' },
  { chave: 'rouboFurto', label: 'Roubo/furto' },
  { chave: 'sobraPerda', label: 'Sobra/perda' },
  { chave: 'outros', label: 'Outros' },
] as const;

/** Só mostra a coluna que teve movimento — 13 colunas zeradas é ruído. */
const colunasComMovimento = computed(() => {
  const linhas = dados.value?.pagamentos ?? [];
  return COLUNAS_PAGAMENTO.filter((c) => linhas.some((l) => Number(l[c.chave]) !== 0));
});

const corClasse = { A: 'success', B: 'warning', C: 'grey' } as const;

/**
 * A cor da cobertura é o aviso: abaixo de 80% o número de margem já não
 * representa o negócio, e quem lê precisa perceber isso sem ler o rodapé.
 */
const corCobertura = computed(() => {
  const c = dados.value?.margem.coberturaPercentual ?? 0;
  return c >= 80 ? 'success' : c >= 50 ? 'warning' : 'error';
});

/* ------------------------------------------------------------------ gráficos */

/**
 * Cor POR FORMA DE PAGAMENTO, fixa.
 *
 * Fixa e não por ranking: um dia sem Pix tiraria a série do meio e repintaria
 * todas as outras — quem olha dois períodos seguidos veria "dinheiro" mudar de
 * cor e leria como coisa diferente. A cor segue a entidade, nunca a posição.
 *
 * Os cinco primeiros tons são os slots 1 a 5 da paleta categórica validada
 * (`node scripts/validate_palette.js`, superfície #FFFFFF, modo claro): passa
 * na faixa de luminosidade, no piso de croma, na separação para daltonismo
 * (pior par adjacente ΔE 9,1) e no piso de visão normal (ΔE 19,6). Três deles
 * ficam abaixo de 3:1 contra o branco — por isso a TABELA logo abaixo do
 * gráfico é obrigatória, não enfeite: é ela que garante a leitura de quem não
 * distingue os tons.
 *
 * Tudo que não é uma das cinco formas principais entra em "Outros". É a regra
 * de dobrar a cauda: mais de seis séries numa pilha ninguém lê, e inventar um
 * sétimo tom quebraria a validação.
 */
const CORES_PAGAMENTO = {
  dinheiro: '#2a78d6',
  pix: '#eb6834',
  debito: '#1baf7a',
  credito: '#eda100',
  voucher: '#e87ba4',
  outros: '#008300',
} as const;

const FORMAS_PRINCIPAIS = ['dinheiro', 'pix', 'debito', 'credito', 'voucher'] as const;

/** Cinza recessivo da grade — um passo fora da superfície, nunca tracejado. */
const GRADE = '#E7EAF0';
const TINTA_FRACA = '#6B7280';

const eixoDias = computed(() => (dados.value?.pagamentos ?? []).map((p) => diaCurto(p.data)));

/**
 * A MEDIDA do gráfico grande.
 *
 * Duas medidas, um eixo de cada vez — nunca as duas juntas. Dinheiro e
 * contagem de vendas têm escalas diferentes; sobrepor as duas num gráfico com
 * dois eixos é o erro mais comum de painel, porque o cruzamento das linhas
 * vira uma coincidência de escala que parece significado.
 */
const MEDIDAS = [
  { valor: 'total', label: 'Faturamento do dia', sufixo: 'R$' },
  { valor: 'numeroVendas', label: 'Nº de vendas', sufixo: '' },
] as const;
const medida = ref<'total' | 'numeroVendas'>('total');
const medidaAtual = computed(() => MEDIDAS.find((m) => m.valor === medida.value)!);

const serieGrande = computed(() => [{
  name: medidaAtual.value.label,
  data: (dados.value?.pagamentos ?? []).map((p) => Number(p[medida.value])),
}]);

const temSerie = computed(() => (dados.value?.pagamentos ?? []).length > 0);

/** O maior dia do período — é o único ponto que ganha rótulo direto. */
const pico = computed(() => {
  const linhas = dados.value?.pagamentos ?? [];
  if (!linhas.length) return null;
  let melhor = linhas[0]!;
  for (const l of linhas) if (Number(l[medida.value]) > Number(melhor[medida.value])) melhor = l;
  return { data: melhor.data, valor: Number(melhor[medida.value]) };
});

const formatarMedida = (v: number) =>
  (medida.value === 'total' ? brl(v) : num(v));

/**
 * O gráfico grande: uma linha, um eixo, o período inteiro.
 *
 * Sem legenda de propósito — série única, e o título já diz o que é. Uma caixa
 * com um quadradinho só repetiria o título e roubaria espaço da linha.
 *
 * Marcador só no hover, e com anel da cor da superfície: ponto em todo dia de
 * um período de 90 dias vira ruído, mas o alvo precisa ser grande o bastante
 * para o dedo acertar.
 */
const opcoesGrande = computed<ApexOptions>(() => ({
  chart: {
    /*
     * Altura em PIXEL, e o container sem altura fixa.
     *
     * Com `height: '100%'` dentro de uma caixa de 420px, o ApexCharts desenhava
     * o gráfico em 420 e jogava a faixa do eixo X para FORA do cartão — os dias
     * apareciam por cima do card seguinte. Visto em print, não deduzido.
     */
    type: 'area',
    height: 420,
    toolbar: { show: false },
    zoom: { enabled: false },
    fontFamily: 'inherit',
    animations: { enabled: true, speed: 400 },
  },
  colors: ['#6515DD'],
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 2, lineCap: 'round' },
  // o preenchimento é uma lavagem, não um bloco: a linha é que carrega o dado
  fill: {
    type: 'gradient',
    gradient: { shadeIntensity: 0, opacityFrom: 0.12, opacityTo: 0, stops: [0, 100] },
  },
  markers: { size: 0, strokeWidth: 2, strokeColors: '#FFFFFF', hover: { size: 8 } },
  grid: {
    borderColor: GRADE,
    strokeDashArray: 0,
    xaxis: { lines: { show: false } },
    padding: { left: 12, right: 24, top: 8 },
  },
  xaxis: {
    categories: eixoDias.value,
    tickAmount: Math.min(12, eixoDias.value.length),
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: { style: { colors: TINTA_FRACA, fontSize: '12px' }, rotate: 0, hideOverlappingLabels: true },
    crosshairs: { show: true, stroke: { color: GRADE, width: 1, dashArray: 0 } },
  },
  yaxis: {
    /*
     * Base em ZERO, obrigatoriamente.
     *
     * A área embaixo da linha é um tamanho, e tamanho só é comparável a partir
     * do zero. Com o eixo cortado em R$ 2 mil — que foi o que o ApexCharts
     * escolheu sozinho —, um dia de R$ 4 mil desenhava uma área que parecia o
     * dobro de um dia de R$ 3 mil. A linha sozinha toleraria o corte; a área
     * preenchida, não.
     */
    min: 0,
    labels: {
      style: { colors: TINTA_FRACA, fontSize: '12px' },
      formatter: (v: number) => (medida.value === 'total'
        ? `R$ ${v.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })}`
        : num(v)),
    },
  },
  tooltip: {
    shared: true,
    intersect: false,
    x: { formatter: (_v, o) => dia(dados.value?.pagamentos?.[o?.dataPointIndex ?? 0]?.data ?? '') },
    y: { formatter: (v: number) => formatarMedida(v) },
  },
  legend: { show: false },
}));

/**
 * Formas de pagamento por dia, empilhadas.
 *
 * Coluna e não linha: cada dia é uma unidade fechada, e a pilha responde a
 * pergunta que interessa — de onde veio o dinheiro daquele dia. O vão de 2px
 * na cor da superfície é o que separa os segmentos; nunca uma borda, que
 * acrescenta tinta sem acrescentar dado.
 */
const seriePagamentos = computed(() => {
  const linhas = dados.value?.pagamentos ?? [];
  if (!linhas.length) return [];

  const series: Array<{ name: string; data: number[]; cor: string }> = [];
  for (const forma of FORMAS_PRINCIPAIS) {
    const data = linhas.map((l) => Number(l[forma]));
    if (data.every((v) => v === 0)) continue; // forma sem movimento não vira série
    const rotulo = COLUNAS_PAGAMENTO.find((c) => c.chave === forma)!.label;
    series.push({ name: rotulo, data, cor: CORES_PAGAMENTO[forma] });
  }

  // a cauda inteira dobrada em "Outros": crediário, sócios, sobra/perda e afins
  const resto = linhas.map((l) => COLUNAS_PAGAMENTO
    .filter((c) => !(FORMAS_PRINCIPAIS as readonly string[]).includes(c.chave))
    .reduce((s, c) => s + Number(l[c.chave]), 0));
  if (resto.some((v) => v !== 0)) {
    series.push({ name: 'Outros', data: resto, cor: CORES_PAGAMENTO.outros });
  }
  return series;
});

const opcoesPagamentos = computed<ApexOptions>(() => ({
  chart: {
    type: 'bar',
    height: 380,
    stacked: true,
    toolbar: { show: false },
    fontFamily: 'inherit',
  },
  colors: seriePagamentos.value.map((s) => s.cor),
  dataLabels: { enabled: false },
  plotOptions: {
    bar: {
      columnWidth: '62%', // sobra de ar na faixa, em vez de preencher o slot
      borderRadius: 4,
      borderRadiusApplication: 'end', // arredonda só a ponta, quadrado na base
    },
  },
  // o vão de 2px que separa os segmentos da pilha, na cor da superfície
  stroke: { show: true, width: 2, colors: ['#FFFFFF'] },
  grid: {
    borderColor: GRADE,
    strokeDashArray: 0,
    xaxis: { lines: { show: false } },
    padding: { left: 12, right: 12 },
  },
  xaxis: {
    categories: eixoDias.value,
    tickAmount: Math.min(12, eixoDias.value.length),
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: { style: { colors: TINTA_FRACA, fontSize: '12px' }, hideOverlappingLabels: true },
  },
  yaxis: {
    labels: {
      style: { colors: TINTA_FRACA, fontSize: '12px' },
      formatter: (v: number) => `R$ ${v.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })}`,
    },
  },
  tooltip: {
    shared: true,
    intersect: false,
    x: { formatter: (_v, o) => dia(dados.value?.pagamentos?.[o?.dataPointIndex ?? 0]?.data ?? '') },
    y: { formatter: (v: number) => brl(v) },
  },
  // legenda SEMPRE, a partir de duas séries: identidade nunca só pela cor
  legend: { show: true, position: 'bottom', horizontalAlign: 'left', markers: { size: 6 } },
}));
</script>

<template>
  <div>
    <!--
      Os filtros ficam ACIMA das abas, numa linha só: eles valem para as três
      visões. Dentro de uma aba, dariam a impressão de filtrar só aquela.
    -->
    <div class="d-flex align-center flex-wrap ga-3 mb-3">
      <v-select
        v-if="isAdmin"
        v-model="loja"
        :items="LOJAS"
        item-title="label"
        item-value="value"
        label="Loja"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 180px"
      />
      <v-text-field
        v-model="inicio"
        type="date"
        label="De"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 190px"
      />
      <v-text-field
        v-model="fim"
        type="date"
        label="Até"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 190px"
      />
      <!--
        `:model-value`, não `v-model`: quem manda são as DATAS. O atalho é um
        atalho — ele escreve nas datas e depois se acende sozinho porque elas
        passaram a bater com ele. Com `v-model` num computado sem setter, o
        botão tentaria guardar estado próprio e sairia de sincronia com o
        filtro na primeira vez que alguém digitasse uma data à mão.
      -->
      <v-btn-toggle :model-value="atalhoAtivo" density="compact" variant="outlined" divided>
        <v-btn v-for="a in ATALHOS" :key="a.dias" :value="a.dias" size="small" @click="aplicarAtalho(a.dias)">
          {{ a.label }}
        </v-btn>
      </v-btn-toggle>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">Atualizar</v-btn>
      <v-btn variant="tonal" prepend-icon="list" to="/vendas/produtos">Produtos vendidos</v-btn>
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <div v-if="carregando && !dados" class="d-flex justify-center pa-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="dados">
      <!--
        O faturamento vem das VENDAS por produto e o nº de vendas vem do
        FECHAMENTO de caixa. São duas fontes: se divergirem, não é erro de
        conta — é a operação (crediário, sobra/perda, etc.).
      -->
      <v-alert
        v-if="dados.qualidade.produtosSemCodigo > 0 || dados.qualidade.outrosPagamento !== 0"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-4"
      >
        <div v-if="dados.qualidade.produtosSemCodigo > 0">
          <strong>{{ num(dados.qualidade.produtosSemCodigo) }}</strong> produto(s) vieram do PDV
          <strong>sem código</strong>, somando {{ brl(dados.qualidade.faturamentoSemCodigo) }}.
          Eles entram no faturamento, mas não dá para ligá-los ao cadastro.
        </div>
        <div v-if="dados.qualidade.outrosPagamento !== 0">
          <strong>{{ brl(dados.qualidade.outrosPagamento) }}</strong> caíram em
          <strong>“Outros”</strong> — é forma de pagamento que o sistema não reconheceu.
        </div>
      </v-alert>

      <v-tabs v-model="aba" class="mb-4" color="primary" density="comfortable">
        <v-tab value="visao" prepend-icon="show_chart">Visão geral</v-tab>
        <v-tab value="relatorios" prepend-icon="assessment">Relatórios</v-tab>
        <v-tab value="graficos" prepend-icon="bar_chart">Gráficos</v-tab>
      </v-tabs>

      <v-alert v-if="semMovimento" type="info" variant="tonal" class="mb-4">
        Nenhuma venda registrada nesse período para esta loja.
      </v-alert>

      <v-window v-else v-model="aba">
        <!-- ─────────────────────────────────────────────── VISÃO GERAL ── -->
        <v-window-item value="visao">
          <v-row class="mb-1">
            <v-col v-for="c in resumoCards" :key="c.label" cols="12" sm="6" md="3">
              <v-card flat border rounded="lg" class="pa-4 h-100">
                <div class="d-flex align-center ga-3">
                  <v-avatar :color="c.cor" size="46" rounded="lg" variant="flat">
                    <v-icon color="white">{{ c.icon }}</v-icon>
                  </v-avatar>
                  <div style="min-width: 0">
                    <div class="text-caption text-medium-emphasis text-uppercase">{{ c.label }}</div>
                    <div class="text-h6 font-weight-bold">{{ c.valor }}</div>
                    <div class="text-caption text-medium-emphasis">{{ c.origem }}</div>
                  </div>
                </div>
              </v-card>
            </v-col>
          </v-row>

          <v-card flat border rounded="lg" class="pa-4 mt-3">
            <div class="d-flex align-center flex-wrap ga-3 mb-1">
              <div>
                <div class="text-subtitle-1 font-weight-bold">{{ medidaAtual.label }} por dia</div>
                <div class="text-caption text-medium-emphasis">
                  {{ dia(dados.periodo.inicio) }} a {{ dia(dados.periodo.fim) }} · fechamento de caixa
                </div>
              </div>
              <v-spacer />
              <!--
                Uma medida de cada vez, num eixo só. Dinheiro e contagem de
                vendas têm escalas diferentes: sobrepor as duas com dois eixos
                faz o cruzamento das linhas parecer significado quando é só
                coincidência de escala.
              -->
              <v-btn-toggle v-model="medida" density="compact" variant="outlined" divided mandatory>
                <v-btn v-for="m in MEDIDAS" :key="m.valor" :value="m.valor" size="small">{{ m.label }}</v-btn>
              </v-btn-toggle>
            </div>

            <div v-if="!temSerie" class="text-caption text-medium-emphasis py-8 text-center">
              Nenhum fechamento de caixa importado nesse período — sem ele não há série diária.
            </div>
            <template v-else>
              <!-- rótulo direto só no PICO: número em todo ponto não se lê -->
              <div v-if="pico" class="text-caption text-medium-emphasis mb-2">
                Maior dia: <strong class="text-high-emphasis">{{ dia(pico.data) }}</strong>
                — {{ formatarMedida(pico.valor) }}
              </div>
              <!-- sem altura fixa no container: a altura vive nas opções, e é o
                   que mantém a faixa do eixo X DENTRO do cartão -->
              <apexchart type="area" :height="420" :options="opcoesGrande" :series="serieGrande" />
            </template>
          </v-card>

          <div class="text-caption text-medium-emphasis mt-3">
            O faturamento sai das vendas por produto e o número de vendas sai do fechamento
            de caixa. São registros diferentes do PDV, então os totais podem não bater:
            o fechamento inclui crediário, sobra/perda e outros lançamentos que não são venda de produto.
          </div>
        </v-window-item>

        <!-- ──────────────────────────────────────────────── RELATÓRIOS ── -->
        <v-window-item value="relatorios">
          <v-row>
            <v-col cols="12" md="6">
              <v-card flat border rounded="lg" class="pa-4 h-100">
                <div class="text-subtitle-1 font-weight-bold mb-3">Mais vendidos</div>
                <div v-for="p in dados.ranking.maisVendidos" :key="`m-${p.produtoCodigo}-${p.produto}`" class="d-flex align-center ga-3 mb-2">
                  <div class="flex-grow-1" style="min-width: 0">
                    <div class="text-body-2 text-truncate">{{ p.produto }}</div>
                    <div class="text-caption text-medium-emphasis">{{ p.produtoCodigo || 'sem código' }}</div>
                  </div>
                  <div class="text-right">
                    <div class="text-body-2 font-weight-bold">{{ num(p.quantidade) }}</div>
                    <div class="text-caption text-medium-emphasis">{{ brl(p.faturamento) }}</div>
                  </div>
                </div>
              </v-card>
            </v-col>

            <v-col cols="12" md="6">
              <v-card flat border rounded="lg" class="pa-4 h-100">
                <div class="text-subtitle-1 font-weight-bold mb-1">Menos vendidos</div>
                <div class="text-caption text-medium-emphasis mb-3">Entre os que tiveram alguma venda no período.</div>
                <div v-for="p in dados.ranking.menosVendidos" :key="`n-${p.produtoCodigo}-${p.produto}`" class="d-flex align-center ga-3 mb-2">
                  <div class="flex-grow-1" style="min-width: 0">
                    <div class="text-body-2 text-truncate">{{ p.produto }}</div>
                    <div class="text-caption text-medium-emphasis">{{ p.produtoCodigo || 'sem código' }}</div>
                  </div>
                  <div class="text-right">
                    <div class="text-body-2 font-weight-bold">{{ num(p.quantidade) }}</div>
                    <div class="text-caption text-medium-emphasis">{{ brl(p.faturamento) }}</div>
                  </div>
                </div>
              </v-card>
            </v-col>
          </v-row>

          <v-card flat border rounded="lg" class="pa-4 mt-4">
            <div class="d-flex align-center flex-wrap ga-2 mb-1">
              <div class="text-subtitle-1 font-weight-bold">Margem e lucro</div>
              <v-spacer />
              <v-btn
                size="small"
                variant="tonal"
                :color="dados.margem.produtosSemVinculo ? 'warning' : undefined"
                to="/vendas/de-para"
              >
                Resolver produtos sem custo
                <template v-if="dados.margem.produtosSemVinculo">({{ num(dados.margem.produtosSemVinculo) }})</template>
              </v-btn>
            </div>

            <!--
              A cobertura vem ANTES do lucro de propósito. Margem calculada sobre
              metade do faturamento, apresentada como total, leva a decisão errada
              de preço — o pão sem custo cadastrado se esconde atrás da Coca-Cola.
            -->
            <div class="d-flex align-center ga-2 mb-1 mt-2">
              <span class="text-body-2">Calculada sobre</span>
              <strong :class="`text-${corCobertura}`">{{ pct(dados.margem.coberturaPercentual) }}</strong>
              <span class="text-body-2">do faturamento</span>
            </div>
            <v-progress-linear
              :model-value="dados.margem.coberturaPercentual"
              :color="corCobertura"
              height="8"
              rounded
              class="mb-3"
            />
            <div class="text-caption text-medium-emphasis mb-4">
              {{ brl(dados.margem.faturamentoSemCusto) }} em vendas ainda não têm custo cadastrado
              <template v-if="dados.margem.produtosSemVinculo">
                ({{ num(dados.margem.produtosSemVinculo) }} produto(s) sem vínculo)
              </template>.
            </div>

            <v-row dense>
              <v-col cols="12" sm="4">
                <div class="text-caption text-medium-emphasis text-uppercase">Custo</div>
                <div class="text-h6 font-weight-bold">{{ brl(dados.margem.custoTotal) }}</div>
              </v-col>
              <v-col cols="12" sm="4">
                <div class="text-caption text-medium-emphasis text-uppercase">Lucro bruto</div>
                <div class="text-h6 font-weight-bold" :class="dados.margem.lucroBruto < 0 ? 'text-error' : 'text-success'">
                  {{ brl(dados.margem.lucroBruto) }}
                </div>
              </v-col>
              <v-col cols="12" sm="4">
                <div class="text-caption text-medium-emphasis text-uppercase">Margem</div>
                <div class="text-h6 font-weight-bold" :class="dados.margem.margemPercentual < 0 ? 'text-error' : ''">
                  {{ pct(dados.margem.margemPercentual) }}
                </div>
              </v-col>
            </v-row>
          </v-card>

          <v-card flat border rounded="lg" class="pa-4 mt-4">
            <div class="text-subtitle-1 font-weight-bold mb-1">Curva ABC</div>
            <div class="text-caption text-medium-emphasis mb-3">
              A = os produtos que somam os primeiros 80% do faturamento; B até 95%; C o restante.
            </div>
            <div v-for="c in dados.curvaAbc" :key="c.classe" class="mb-3">
              <div class="d-flex align-center ga-2 mb-1">
                <v-chip :color="corClasse[c.classe]" size="small" variant="tonal" class="font-weight-bold">{{ c.classe }}</v-chip>
                <span class="text-body-2">{{ num(c.produtos) }} produto(s)</span>
                <v-spacer />
                <span class="text-body-2 font-weight-bold">{{ brl(c.faturamento) }}</span>
                <span class="text-caption text-medium-emphasis">{{ pct(c.percentual) }}</span>
              </div>
              <v-progress-linear :model-value="c.percentual" :color="corClasse[c.classe]" height="6" rounded />
            </div>
          </v-card>
        </v-window-item>

        <!-- ────────────────────────────────────────────────── GRÁFICOS ── -->
        <v-window-item value="graficos">
          <v-card flat border rounded="lg" class="pa-4">
            <div class="text-subtitle-1 font-weight-bold mb-1">Formas de pagamento por dia</div>
            <div class="text-caption text-medium-emphasis mb-3">
              De onde veio o dinheiro de cada dia. Crediário, sócios, sobra/perda e as demais
              formas entram somadas em “Outros”.
            </div>

            <div v-if="!dados.pagamentos.length" class="text-caption text-medium-emphasis py-8 text-center">
              Nenhum fechamento de caixa importado nesse período.
            </div>
            <template v-else>
              <!-- idem: a altura vive nas opções do gráfico, nunca no container -->
              <apexchart type="bar" :height="380" :options="opcoesPagamentos" :series="seriePagamentos" />

              <!--
                A TABELA é exigência, não complemento.
                Três dos tons da pilha ficam abaixo de 3:1 contra o branco — quem
                não distingue cor precisa de um caminho que não dependa dela. É
                esta tabela. Tirá-la deixaria o gráfico sem leitura alternativa.
              -->
              <div class="text-caption text-medium-emphasis mt-4 mb-2">
                Os mesmos números, forma por forma — é por aqui que se lê sem depender da cor.
              </div>
              <div style="overflow-x: auto">
                <v-table density="compact">
                  <thead>
                    <tr>
                      <th class="text-left">Dia</th>
                      <th class="text-right">Vendas</th>
                      <th v-for="c in colunasComMovimento" :key="c.chave" class="text-right">{{ c.label }}</th>
                      <th class="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="l in dados.pagamentos" :key="l.data">
                      <td>{{ dia(l.data) }}</td>
                      <td class="text-right">{{ num(l.numeroVendas) }}</td>
                      <td v-for="c in colunasComMovimento" :key="c.chave" class="text-right">{{ brl(Number(l[c.chave])) }}</td>
                      <td class="text-right font-weight-bold">{{ brl(l.total) }}</td>
                    </tr>
                  </tbody>
                </v-table>
              </div>
            </template>
          </v-card>
        </v-window-item>
      </v-window>
    </template>
  </div>
</template>
