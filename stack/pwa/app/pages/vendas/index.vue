<script setup lang="ts">
import type { ApexOptions } from 'apexcharts';
import { VendasDatas } from '@pralis/shared';
import type { VendasReport, VendasRankingResposta, DetalhePdv, AbcProdutos, Pulso } from '~/composables/useApi';

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
const aba = ref<'visao' | 'ranking' | 'abc' | 'graficos'>('visao');

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

/**
 * O PULSO da importação.
 *
 * Existe por um caso real: o robô parou em 08/09/2026 e ninguém percebeu por
 * seis dias. Relatório vazio não grita — ele só parece um dia fraco, e quem
 * olha conclui que a semana foi ruim. Este aviso é a diferença entre descobrir
 * no mesmo dia e descobrir quando alguém estranha.
 */
const pulso = ref<Pulso | null>(null);

async function carregarPulso() {
  try {
    pulso.value = await api.vendasPulso();
  } catch {
    // sinal de saúde não pode derrubar a tela: sem ele, a tela segue igual
    pulso.value = null;
  }
}

const fontesAtrasadas = computed(() => (pulso.value?.fontes ?? []).filter((f) => f.atrasado));

const NOME_DA_FONTE: Record<string, string> = {
  venda_produto_dia: 'vendas por produto',
  fechamento_caixa_dia: 'fechamento de caixa',
};

onMounted(() => { carregar(); carregarPulso(); });
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
    { label: 'Faturamento', origem: 'vendas por produto', valor: brl(r.faturamento), icon: 'payments', cor: 'var(--cx-sales-revenue)' },
    { label: 'Quantidade vendida', origem: 'vendas por produto', valor: num(r.quantidade), icon: 'inventory_2', cor: 'var(--cx-sales-volume)' },
    { label: 'Nº de vendas', origem: 'fechamento de caixa', valor: num(r.numeroVendas), icon: 'receipt_long', cor: 'var(--cx-sales-revenue)' },
    { label: 'Ticket médio', origem: 'fechamento de caixa', valor: brl(r.ticketMedio), icon: 'trending_up', cor: 'var(--cx-sales-volume)' },
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
  colors: ['#a96e00'],
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

/* ------------------------------------------------------------------- ranking */

/**
 * As quatro dimensões do ranking.
 *
 * O texto de cada uma diz o que ela PODE e o que não pode — é a única defesa
 * contra alguém ler "por caixa" e esperar ver produtos ali.
 */
const DIMENSOES = [
  { valor: 'produto', label: 'Produto', icone: 'inventory_2', nota: 'Direto da venda, inclusive o que saiu sem código.' },
  { valor: 'grupo', label: 'Grupo', icone: 'category', nota: 'Grupo de mercadorias do cadastro.' },
  { valor: 'setor', label: 'Setor', icone: 'groups', nota: 'Produção, panificação, confeitaria, loja — o setor do cadastro.' },
  { valor: 'pdv', label: 'Caixa (PDV)', icone: 'point_of_sale', nota: 'Fechamento por caixa. Produtos exigem vínculo original item → venda → PDV.' },
] as const;

const dimensao = ref<'produto' | 'grupo' | 'setor' | 'pdv'>('setor');
const dimensaoAtual = computed(() => DIMENSOES.find((d) => d.valor === dimensao.value)!);
const ranking = ref<VendasRankingResposta | null>(null);
const carregandoRanking = ref(false);
const erroRanking = ref('');
const pdvAberto = ref<VendasRankingResposta['itens'][number] | null>(null);
const detalhePdv = ref<DetalhePdv | null>(null);
const carregandoDetalhe = ref(false);
const erroDetalhe = ref('');
const ordemPdv = ref<'quantidade' | 'faturamento'>('quantidade');
let pedidoDetalhe = 0;
async function carregarDetalhePdv() {
  const pdv = pdvAberto.value;
  const pedido = ++pedidoDetalhe;
  detalhePdv.value = null;
  erroDetalhe.value = '';
  if (!pdv || pdv.chave.startsWith('legado:')) return;
  carregandoDetalhe.value = true;
  try {
    const resposta = await api.vendasPdvDetalhe({
      ...(isAdmin.value ? { loja: loja.value } : {}),
      dispositivoIdErp: pdv.chave,
      inicio: `${inicio.value}T00:00`,
      fim: `${fim.value}T23:59`,
      ordenar: ordemPdv.value,
    });
    if (pedido === pedidoDetalhe) detalhePdv.value = resposta;
  } catch (e: unknown) {
    if (pedido === pedidoDetalhe) erroDetalhe.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar os itens deste PDV.';
  } finally {
    if (pedido === pedidoDetalhe) carregandoDetalhe.value = false;
  }
}
watch([pdvAberto, ordemPdv], carregarDetalhePdv);
watch([loja, inicio, fim], () => { pdvAberto.value = null; });

async function carregarRanking() {
  carregandoRanking.value = true;
  erroRanking.value = '';
  try {
    ranking.value = await api.vendasRanking({
      ...(isAdmin.value ? { loja: loja.value } : {}),
      inicio: inicio.value,
      fim: fim.value,
      dimensao: dimensao.value,
    });
  } catch (e: unknown) {
    ranking.value = null;
    erroRanking.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar o ranking.';
  } finally {
    carregandoRanking.value = false;
  }
}

/* Só busca quando a aba está aberta — ninguém paga por dado que não vai ver. */
watch([aba, dimensao, loja, inicio, fim], () => {
  if (aba.value === 'ranking') carregarRanking();
});

/** Cor da cobertura, mesma régua da margem: abaixo de 80% o ranking já não representa. */
const corCoberturaRanking = computed(() => {
  const c = ranking.value?.cobertura.percentual ?? 0;
  return c >= 80 ? 'success' : c >= 50 ? 'warning' : 'error';
});

/** Barra proporcional ao primeiro colocado — comparação dentro da própria lista. */
const fatiaDoLider = (v: number) => {
  const lider = ranking.value?.itens[0]?.pontos ?? 0;
  return lider > 0 ? (v / lider) * 100 : 0;
};

/* ----------------------------------------------------------------- curva ABC */

/** Indicadores textuais e lista substituem as faixas gráficas da curva ABC. */
const CORES_ABC = { A: '#a96e00', B: '#2563a8', C: '#6B7280' } as const;

const abcTemDados = computed(() => (dados.value?.curvaAbc ?? []).some((c) => c.produtos > 0));

const totalProdutosAbc = computed(() =>
  (dados.value?.curvaAbc ?? []).reduce((s, c) => s + c.produtos, 0));

/* ---- a LISTA de produtos da classe: o que não pode faltar na prateleira ---- */

const classeAberta = ref<'A' | 'B' | 'C'>('A');
const listaAbc = ref<AbcProdutos | null>(null);
const carregandoAbc = ref(false);
const erroAbc = ref('');

async function carregarListaAbc() {
  carregandoAbc.value = true;
  erroAbc.value = '';
  try {
    listaAbc.value = await api.vendasCurvaAbc({
      ...(isAdmin.value ? { loja: loja.value } : {}),
      inicio: inicio.value,
      fim: fim.value,
      classe: classeAberta.value,
    });
  } catch (e: unknown) {
    listaAbc.value = null;
    erroAbc.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar a lista.';
  } finally {
    carregandoAbc.value = false;
  }
}

/* Só busca com a aba aberta — a consulta cruza a venda inteira com o cadastro. */
watch([aba, classeAberta, loja, inicio, fim], () => {
  if (aba.value === 'abc') carregarListaAbc();
});

/**
 * A ordenação da lista.
 *
 * `diasDeMaximo` crescente é a ordem que interessa para reposição: quem tem
 * teto para menos dias precisa de atenção mais frequente. Quem não tem máximo
 * cadastrado vai para o FIM — não é "aguenta muito tempo", é "não dá para
 * saber", e misturar os dois esconderia o buraco de cadastro.
 */
const ORDENS = [
  { valor: 'faturamento', label: 'Faturamento' },
  { valor: 'giro', label: 'Gira mais rápido' },
  { valor: 'risco', label: 'Menos dias de estoque' },
] as const;
const ordem = ref<'faturamento' | 'giro' | 'risco'>('faturamento');
const filtroSetor = ref<string | null>(null);
const filtroGrupo = ref<string | null>(null);
const filtroProduto = ref('');
const paginaAbc = ref(1);
const TAMANHO_PAGINA_ABC = 25;
const setoresAbc = computed(() => [...new Set((listaAbc.value?.itens ?? []).map((i) => i.setor).filter((v): v is string => !!v))].sort());
const gruposAbc = computed(() => [...new Set((listaAbc.value?.itens ?? []).map((i) => i.grupo).filter((v): v is string => !!v))].sort());
watch([classeAberta, loja, inicio, fim, filtroSetor, filtroGrupo, filtroProduto, ordem], () => { paginaAbc.value = 1; });

const itensAbcOrdenados = computed(() => {
  const termo = (filtroProduto.value ?? '').trim().toLocaleLowerCase('pt-BR');
  const itens = (listaAbc.value?.itens ?? []).filter((i) =>
    (!filtroSetor.value || i.setor === filtroSetor.value)
    && (!filtroGrupo.value || i.grupo === filtroGrupo.value)
    && (!termo || i.produto.toLocaleLowerCase('pt-BR').includes(termo) || i.produtoCodigo.includes(termo)));
  if (ordem.value === 'giro') return itens.sort((a, b) => b.porDia - a.porDia);
  if (ordem.value === 'risco') {
    return itens.sort((a, b) => {
      if (a.diasDeMaximo == null && b.diasDeMaximo == null) return b.faturamento - a.faturamento;
      if (a.diasDeMaximo == null) return 1; // sem cadastro vai para o fim
      if (b.diasDeMaximo == null) return -1;
      return a.diasDeMaximo - b.diasDeMaximo;
    });
  }
  return itens; // já vem ordenado por faturamento
});
const paginasAbc = computed(() => Math.ceil(itensAbcOrdenados.value.length / TAMANHO_PAGINA_ABC));
const itensAbcPagina = computed(() => itensAbcOrdenados.value.slice((paginaAbc.value - 1) * TAMANHO_PAGINA_ABC, paginaAbc.value * TAMANHO_PAGINA_ABC));

const abcFatias = computed(() => (dados.value?.curvaAbc ?? []).map((c) => ({
  classe: c.classe,
  cor: CORES_ABC[c.classe],
  faturamento: c.faturamento,
  produtos: c.produtos,
  pctFaturamento: c.percentual,
  pctProdutos: totalProdutosAbc.value ? (c.produtos / totalProdutosAbc.value) * 100 : 0,
})));

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
      <v-btn variant="tonal" prepend-icon="leaderboard" color="primary" to="/vendas/painel">Painel de setores</v-btn>
    </div>

    <!--
      O aviso de dado velho vem ANTES de tudo, inclusive do erro de período.

      Um relatório montado sobre dado que parou de chegar não está errado — ele
      está incompleto, e isso é pior: os números fecham, os gráficos desenham, e
      nada na tela denuncia que faltam dias. Sem esta faixa, a única pista é
      alguém estranhar que a semana foi fraca.
    -->
    <v-alert
      v-if="fontesAtrasadas.length"
      type="warning"
      variant="tonal"
      class="mb-4"
      icon="sync_problem"
    >
      <div class="font-weight-bold mb-1">O robô parou de mandar dados.</div>
      <div v-for="f in fontesAtrasadas" :key="`${f.loja}-${f.tipo}`" class="text-body-2">
        <strong>{{ f.loja }}</strong> · {{ NOME_DA_FONTE[f.tipo] ?? f.tipo }}:
        <template v-if="f.ultimoDia">
          última venda registrada em <strong>{{ dia(f.ultimoDia) }}</strong>
          — faz {{ num(f.diasSemDados ?? 0) }} dia(s).
        </template>
        <template v-else>nunca recebeu nenhum lote.</template>
      </div>
      <div class="text-caption mt-2">
        Os números abaixo só contam até aí. Verifique a máquina da loja e o agendamento do robô.
      </div>
    </v-alert>

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
        <v-tab value="ranking" prepend-icon="leaderboard">Ranking</v-tab>
        <v-tab value="abc" prepend-icon="donut_large">Curva ABC</v-tab>
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

          <v-card flat border rounded="lg" class="pa-4 mt-4">
            <div class="d-flex align-center flex-wrap ga-2 mb-2">
              <div class="text-subtitle-1 font-weight-bold">Margem e lucro bruto</div>
              <v-spacer />
              <v-btn size="small" variant="tonal" to="/vendas/de-para">Resolver produtos sem custo</v-btn>
            </div>
            <div class="text-body-2 mb-2">
              Cobertura de custo: <strong>{{ pct(dados.margem.coberturaPercentual) }}</strong> do faturamento.
              {{ brl(dados.margem.faturamentoSemCusto) }} ainda não têm custo cadastrado.
            </div>
            <v-progress-linear :model-value="dados.margem.coberturaPercentual" :color="corCobertura" height="6" rounded class="mb-4" />
            <v-row dense>
              <v-col cols="12" sm="4"><div class="text-caption">Custo</div><div class="text-h6 font-weight-bold">{{ brl(dados.margem.custoTotal) }}</div></v-col>
              <v-col cols="12" sm="4"><div class="text-caption">Lucro bruto</div><div class="text-h6 font-weight-bold sales-profit">{{ brl(dados.margem.lucroBruto) }}</div></v-col>
              <v-col cols="12" sm="4"><div class="text-caption">Margem</div><div class="text-h6 font-weight-bold sales-profit">{{ pct(dados.margem.margemPercentual) }}</div></v-col>
            </v-row>
            <div v-if="dados.margem.produtosSemVinculo" class="text-caption text-medium-emphasis mt-2">
              {{ num(dados.margem.produtosSemVinculo) }} produto(s) precisam de vínculo para apuração completa.
            </div>
          </v-card>
        </v-window-item>

        <!-- ─────────────────────────────────────────────────── RANKING ── -->
        <v-window-item value="ranking">
          <v-card flat border rounded="lg" class="pa-4">
            <div class="d-flex align-center flex-wrap ga-3 mb-2">
              <div>
                <div class="text-subtitle-1 font-weight-bold">Do que mais vende ao que menos vende</div>
                <div class="text-caption text-medium-emphasis">{{ dimensaoAtual.nota }}</div>
              </div>
              <v-spacer />
              <v-btn-toggle v-model="dimensao" density="compact" variant="outlined" divided mandatory>
                <v-btn v-for="d in DIMENSOES" :key="d.valor" :value="d.valor" size="small" :prepend-icon="d.icone">
                  {{ d.label }}
                </v-btn>
              </v-btn-toggle>
            </div>

            <v-alert v-if="erroRanking" type="error" variant="tonal" density="compact" class="mb-3">
              {{ erroRanking }}
            </v-alert>

            <div v-if="carregandoRanking && !ranking" class="d-flex justify-center pa-10">
              <v-progress-circular indeterminate color="primary" />
            </div>

            <template v-else-if="ranking">
              <!--
                A cobertura vem ANTES da lista, pelo mesmo motivo da margem: um
                ranking montado sobre metade do faturamento, lido como se fosse
                o todo, premia o setor errado.
              -->
              <div v-if="ranking.cobertura.percentual < 100" class="mb-3">
                <div class="d-flex align-center ga-2 mb-1">
                  <span class="text-body-2">Este ranking cobre</span>
                  <strong :class="`text-${corCoberturaRanking}`">{{ pct(ranking.cobertura.percentual) }}</strong>
                  <span class="text-body-2">do faturamento do período</span>
                </div>
                <v-progress-linear
                  :model-value="ranking.cobertura.percentual"
                  :color="corCoberturaRanking"
                  height="6"
                  rounded
                />
                <div class="text-caption text-medium-emphasis mt-1">
                  {{ ranking.cobertura.faturamentoSemClassificacao !== null ? brl(ranking.cobertura.faturamentoSemClassificacao) + " em " : "" }}
                  {{ num(ranking.cobertura.linhasSemVinculo) }} linha(s) não casaram com produto do cadastro.
                  <NuxtLink to="/vendas/de-para" class="text-primary">Resolver no de-para</NuxtLink>.
                </div>
              </div>

              <div v-if="!ranking.itens.length" class="text-caption text-medium-emphasis py-8 text-center">
                Nenhuma venda classificada nesta dimensão no período.
              </div>

              <div v-for="i in ranking.itens" :key="i.chave" class="mb-3">
                <div class="d-flex align-center ga-3">
                  <div
                    class="text-caption font-weight-bold text-center flex-shrink-0"
                    style="width: 28px"
                    :class="i.posicao <= 3 ? 'sales-revenue' : 'text-medium-emphasis'"
                  >{{ i.posicao }}º</div>
                  <div class="flex-grow-1" style="min-width: 0">
                    <v-btn
                      v-if="dimensao === 'pdv'"
                      variant="text"
                      size="small"
                      class="sales-pdv-link"
                      append-icon="chevron_right"
                      :aria-label="`Ver detalhes do PDV ${i.rotulo}`"
                      @click="pdvAberto = i"
                    >{{ i.rotulo }}</v-btn>
                    <div v-else class="text-body-2 text-truncate">{{ i.rotulo }}</div>
                    <div class="text-caption text-medium-emphasis">
                      {{ pct(i.participacao) }} do período
                      <template v-if="i.quantidade !== null"> · {{ num(i.quantidade) }} un</template>
                      <template v-if="i.numeroVendas !== null"> · {{ num(i.numeroVendas) }} vendas</template>
                    </div>
                  </div>
                  <div class="text-right flex-shrink-0">
                    <div v-if="i.faturamento !== null" class="text-body-2 font-weight-bold sales-revenue">{{ brl(i.faturamento) }}</div>
                    <div class="text-caption text-medium-emphasis">{{ num(i.pontos) }} pts</div>
                  </div>
                </div>
                <!-- barra proporcional ao LÍDER: compara dentro da própria lista -->
                <v-progress-linear
                  :model-value="fatiaDoLider(i.pontos)"
                  :color="i.posicao === 1 ? '#a96e00' : 'grey-lighten-1'"
                  height="4"
                  rounded
                  class="mt-1"
                />
              </div>

              <div v-if="ranking.itens.length" class="text-caption text-medium-emphasis mt-4">
                Pontuação = faturamento × 25%. Total do período:
                <strong class="text-high-emphasis">{{ num(ranking.pontosTotal) }} pts</strong>.
                <template v-if="ranking.campo"> Classificado pelo campo <code>{{ ranking.campo }}</code> do cadastro.</template>
              </div>
            </template>
          </v-card>
          <v-card flat border rounded="lg" class="pa-4 mt-4">
            <div class="text-subtitle-1 font-weight-bold mb-2">Produtos com menor venda no período</div>
            <div class="text-caption text-medium-emphasis mb-3">Entre os produtos que tiveram alguma venda.</div>
            <div v-if="!dados.ranking.menosVendidos.length" class="text-body-2 text-medium-emphasis">Nenhum produto vendido no período.</div>
            <div v-for="p in dados.ranking.menosVendidos" :key="`n-${p.produtoCodigo}-${p.produto}`" class="sales-rank-row">
              <div><div class="font-weight-medium">{{ p.produto }}</div><div class="text-caption text-medium-emphasis">{{ p.produtoCodigo || 'sem código' }}</div></div>
              <div class="text-right"><div class="sales-volume font-weight-bold">{{ num(p.quantidade) }} vendidos</div><div class="sales-revenue text-caption">{{ brl(p.faturamento) }}</div></div>
            </div>
          </v-card>
        </v-window-item>

        <!-- ───────────────────────────────────────────────── CURVA ABC ── -->
        <v-window-item value="abc">
          <v-card flat border rounded="lg" class="pa-4">
            <div class="text-subtitle-1 font-weight-bold mb-1">Curva ABC</div>
            <div class="text-caption text-medium-emphasis mb-4">
              <strong>A</strong> são os produtos que somam os primeiros 80% do faturamento;
              <strong>B</strong> vai até 95%; <strong>C</strong> é todo o resto.
            </div>

            <div v-if="!abcTemDados" class="text-caption text-medium-emphasis py-8 text-center">
              Sem vendas no período para montar a curva.
            </div>

            <template v-else>
              <v-row dense>
                <v-col v-for="f in abcFatias" :key="`card-${f.classe}`" cols="12" sm="4">
                  <v-card flat border rounded="lg" class="pa-4 h-100">
                    <div class="d-flex align-center ga-2 mb-2">
                      <v-avatar :color="f.cor" size="32" rounded="lg" variant="flat">
                        <span class="text-white font-weight-bold">{{ f.classe }}</span>
                      </v-avatar>
                      <div class="text-caption text-medium-emphasis">
                        {{ num(f.produtos) }} produto(s) · {{ pct(f.pctProdutos) }} do catálogo vendido
                      </div>
                    </div>
                    <div class="text-h6 font-weight-bold">{{ brl(f.faturamento) }}</div>
                    <div class="text-caption text-medium-emphasis">{{ pct(f.pctFaturamento) }} do faturamento</div>
                  </v-card>
                </v-col>
              </v-row>

              <div class="text-caption text-medium-emphasis mt-4">
                A quantidade de produtos da classe A varia conforme as vendas; não é fixada em 20% do catálogo.
              </div>
            </template>
          </v-card>

          <!-- ───── a LISTA: quais produtos são esses ───── -->
          <v-card flat border rounded="lg" class="pa-4 mt-4">
            <div class="d-flex align-center flex-wrap ga-3 mb-2">
              <div>
                <div class="text-subtitle-1 font-weight-bold">
                  Produtos da classe {{ classeAberta }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  O que sustenta o faturamento — e o que não pode faltar na prateleira.
                </div>
              </div>
              <v-spacer />
              <v-btn-toggle v-model="classeAberta" density="compact" variant="outlined" divided mandatory>
                <v-btn v-for="c in (['A', 'B', 'C'] as const)" :key="c" :value="c" size="small">{{ c }}</v-btn>
              </v-btn-toggle>
              <v-btn-toggle v-model="ordem" density="compact" variant="outlined" divided mandatory>
                <v-btn v-for="o in ORDENS" :key="o.valor" :value="o.valor" size="small">{{ o.label }}</v-btn>
              </v-btn-toggle>
            </div>

            <v-alert v-if="erroAbc" type="error" variant="tonal" density="compact" class="mb-3">{{ erroAbc }}</v-alert>

            <div v-if="carregandoAbc && !listaAbc" class="d-flex justify-center pa-10">
              <v-progress-circular indeterminate color="primary" />
            </div>

            <template v-else-if="listaAbc">
              <div class="sales-abc-filters mb-4" aria-label="Filtros da lista ABC">
                <v-select v-model="filtroSetor" :items="setoresAbc" label="Setor" clearable variant="outlined" density="compact" hide-details />
                <v-select v-model="filtroGrupo" :items="gruposAbc" label="Grupo" clearable variant="outlined" density="compact" hide-details />
                <v-text-field v-model="filtroProduto" label="Produto ou código" prepend-inner-icon="search" clearable variant="outlined" density="compact" hide-details />
              </div>
              <div class="text-caption text-medium-emphasis mb-3">
                {{ num(itensAbcOrdenados.length) }} produto(s) nesta lista após os filtros.
                Os filtros de setor, grupo e produto aplicam-se somente à lista ABC; totais gerais e PDVs permanecem sem esse recorte.
              </div>
              <!--
                O AVISO vem antes da tabela, de propósito.

                O sistema NÃO guarda saldo de estoque — nem no banco nem na
                planilha (a aba de estoque é um formulário de contagem mensal,
                com a coluna de quantidade em branco). Então "dias de máximo" é
                o TETO, não o que resta hoje. Sem esta frase, alguém leria "3,3
                dias" como "acaba quinta-feira" e compraria errado.
              -->
              <v-alert type="info" variant="tonal" density="compact" class="mb-3">
                <strong>Não há saldo de estoque no sistema.</strong>
                A coluna <em>dias de máximo</em> diz em quantos dias a venda deste ritmo
                consumiria o estoque <strong>máximo cadastrado</strong> — é o teto, não o que
                resta hoje na prateleira.
              </v-alert>

              <div
                v-if="listaAbc.semCadastro || listaAbc.semEstoqueMax"
                class="text-caption text-medium-emphasis mb-3"
              >
                <template v-if="listaAbc.semCadastro">
                  <strong class="text-warning">{{ num(listaAbc.semCadastro) }}</strong>
                  produto(s) desta classe não casaram com o cadastro — sem custo, mínimo nem máximo.
                  <NuxtLink to="/vendas/de-para" class="text-primary">Resolver no de-para</NuxtLink>.
                </template>
                <template v-if="listaAbc.semEstoqueMax">
                  <span v-if="listaAbc.semCadastro"> · </span>
                  <strong class="text-warning">{{ num(listaAbc.semEstoqueMax) }}</strong>
                  estão sem estoque máximo cadastrado.
                </template>
              </div>

              <div v-if="!itensAbcOrdenados.length" class="text-caption text-medium-emphasis py-8 text-center">
                Nenhum produto nesta classe no período.
              </div>

              <div v-else style="overflow-x: auto">
                <v-table density="compact">
                  <thead>
                    <tr>
                      <th class="text-left">#</th>
                      <th class="text-left">Produto</th>
                      <th class="text-left">Setor</th>
                      <th class="text-right">Vendeu</th>
                      <th class="text-right">Por dia</th>
                      <th class="text-right">Faturou</th>
                      <th class="text-right">% acum.</th>
                      <th class="text-right">Mín.</th>
                      <th class="text-right">Máx.</th>
                      <th class="text-right">Dias de máx.</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="i in itensAbcPagina" :key="`${i.produtoCodigo}-${i.produto}`" :class="{ 'sales-abc-a': i.classe === 'A' }">
                      <td class="text-medium-emphasis">{{ i.posicao }}</td>
                      <td>
                        <div class="text-truncate" style="max-width: 320px">{{ i.produto }}</div>
                        <div class="text-caption text-medium-emphasis">
                          {{ i.produtoCodigo || 'sem código' }}
                          <span v-if="!i.productId" class="text-warning"> · fora do cadastro</span>
                        </div>
                      </td>
                      <td class="text-caption">{{ i.setor ?? '—' }}</td>
                      <td class="text-right">{{ num(i.quantidade) }}</td>
                      <td class="text-right">{{ num(i.porDia) }}</td>
                      <td class="text-right font-weight-bold">{{ brl(i.faturamento) }}</td>
                      <td class="text-right text-medium-emphasis">{{ pct(i.acumulado) }}</td>
                      <td class="text-right">{{ i.estoqueMin != null ? num(i.estoqueMin) : '—' }}</td>
                      <td class="text-right">{{ i.estoqueMax != null ? num(i.estoqueMax) : '—' }}</td>
                      <!--
                        Vermelho abaixo de 7 dias, âmbar até 15: é a faixa em que
                        a reposição precisa ser semanal ou mais frequente. Cor
                        NUNCA sozinha — o número está escrito ao lado.
                      -->
                      <td
                        class="text-right font-weight-bold"
                        :class="i.diasDeMaximo == null ? 'text-disabled'
                          : i.diasDeMaximo < 7 ? 'text-error'
                            : i.diasDeMaximo < 15 ? 'text-warning' : ''"
                      >{{ i.diasDeMaximo != null ? `${num(i.diasDeMaximo)} d` : 'sem máx.' }}</td>
                    </tr>
                  </tbody>
                </v-table>
              </div>

              <v-pagination v-if="paginasAbc > 1" v-model="paginaAbc" :length="paginasAbc" :total-visible="5" aria-label="Páginas da lista ABC" class="mt-4" />

              <div class="text-caption text-medium-emphasis mt-3">
                Período de {{ num(listaAbc.periodo.dias) }} dia(s).
                <strong>Por dia</strong> é a venda média no período — é o ritmo que consome a prateleira.
              </div>
            </template>
          </v-card>
        </v-window-item>

        <!-- ──────────────────────────────────────────────── RELATÓRIOS ── -->

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

    <v-dialog :model-value="pdvAberto !== null" max-width="650" @update:model-value="v => { if (!v) pdvAberto = null; }">
      <v-card v-if="pdvAberto" rounded="lg" class="pa-5">
        <div class="d-flex align-center ga-3 mb-4">
          <div class="text-h6 font-weight-bold">{{ pdvAberto.rotulo }}</div>
          <v-spacer />
          <v-btn icon="close" variant="text" aria-label="Fechar detalhes do PDV" @click="pdvAberto = null" />
        </div>
        <div class="text-body-2 mb-4">{{ dia(inicio) }} a {{ dia(fim) }} · fechamento diário de caixa</div>
        <div class="d-flex flex-wrap ga-6 mb-4">
          <div><div class="text-caption">Faturamento</div><strong class="sales-revenue">{{ pdvAberto.faturamento === null ? 'Restrito' : brl(pdvAberto.faturamento) }}</strong></div>
          <div><div class="text-caption">Nº de vendas</div><strong class="sales-revenue">{{ num(pdvAberto.numeroVendas ?? 0) }}</strong></div>
          <div><div class="text-caption">Ticket médio</div><strong class="sales-volume">{{ pdvAberto.faturamento !== null && pdvAberto.numeroVendas ? brl(pdvAberto.faturamento / pdvAberto.numeroVendas) : '—' }}</strong></div>
        </div>
        <v-progress-linear v-if="carregandoDetalhe" indeterminate color="primary" class="mb-3" />
        <v-alert v-if="erroDetalhe" type="error" variant="tonal" class="mb-3">{{ erroDetalhe }}</v-alert>
        <v-alert v-if="pdvAberto.chave.startsWith('legado:') || (!carregandoDetalhe && !detalhePdv?.disponivel)" type="info" variant="tonal">
          Produtos por PDV ainda indisponíveis neste período. O fechamento antigo não traz o ID do dispositivo e o histórico de produtos chegou somente por dia.
          Não associamos itens a caixas por nome ou horário aproximado.
        </v-alert>
        <template v-if="detalhePdv?.disponivel">
          <div class="d-flex flex-wrap align-center ga-2 mb-3">
            <div class="font-weight-bold">Produtos deste PDV</div>
            <v-spacer />
            <v-btn-toggle v-model="ordemPdv" mandatory density="compact" variant="outlined" divided>
              <v-btn value="quantidade" size="small">Mais vendidos</v-btn>
              <v-btn value="faturamento" size="small">Maior faturamento</v-btn>
            </v-btn-toggle>
          </div>
          <div class="text-caption text-medium-emphasis mb-2">
            {{ num(detalhePdv.numeroVendas) }} venda(s) com itens · {{ pct(detalhePdv.coberturaCadastroPercentual) }} do faturamento dos itens conciliado ao cadastro.
            Período de dias completos; horas individuais somente nos itens importados.
          </div>
          <div v-if="detalhePdv.fechamento" class="text-caption text-medium-emphasis mb-2">
            Fechamento: {{ detalhePdv.fechamento.total === null ? 'restrito' : brl(detalhePdv.fechamento.total) }}
            · diferença frente aos itens: {{ detalhePdv.fechamento.diferenca === null ? 'restrita' : brl(detalhePdv.fechamento.diferenca) }}.
            Descontos, cancelamentos, devoluções e lançamentos de caixa podem explicar divergências; confira a origem antes de concluir.
          </div>
          <div v-else class="text-caption text-medium-emphasis mb-2">Sem fechamento identificado pelo mesmo ID do dispositivo para comparar.</div>
          <div v-if="!detalhePdv.itens.length" class="text-body-2 text-medium-emphasis py-4">Nenhum item não cancelado neste período.</div>
          <div v-else class="sales-pdv-products">
            <div v-for="item in detalhePdv.itens" :key="`${item.produtoIdErp}-${item.produtoCodigo}-${item.produto}`" class="sales-rank-row">
              <div>
                <div class="font-weight-medium">{{ item.produto }}</div>
                <div class="text-caption text-medium-emphasis">{{ item.produtoCodigo || 'sem código' }} · {{ item.produtoCadastro || 'fora do cadastro' }}</div>
              </div>
              <div class="text-right flex-shrink-0"><div class="sales-volume font-weight-bold">{{ num(item.quantidade) }}</div><div v-if="item.faturamento !== null" class="sales-revenue text-caption">{{ brl(item.faturamento) }}</div></div>
            </div>
          </div>
        </template>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.sales-abc-a { background: var(--cx-sales-revenue-wash); }
.sales-abc-a td:first-child { border-left: 3px solid var(--cx-sales-revenue); }
.sales-profit { color: var(--cx-sales-profit); }
.sales-volume { color: var(--cx-sales-volume); }
.sales-revenue { color: var(--cx-sales-revenue); }
.sales-rank-row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-top: 1px solid var(--cx-line-soft); }
.sales-pdv-link { text-transform: none; padding-inline: 0; max-width: 100%; }
.sales-pdv-products { max-height: 360px; overflow-y: auto; }
.sales-abc-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 700px) { .sales-abc-filters { grid-template-columns: 1fr; } }
</style>
