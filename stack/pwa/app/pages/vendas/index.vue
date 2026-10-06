<script setup lang="ts">
import type { ApexOptions } from 'apexcharts';
import { VendasDatas, VendasFormato, VendasPagamentos } from '@pralis/shared';
import type { VendasReport, VendasRankingResposta, DetalhePdv, AbcProdutos, Pulso, ListaVendas, VendaResumo, VendaDetalhe } from '~/composables/useApi';

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
const route = useRoute();
const router = useRouter();
const q = (k: string) => (typeof route.query[k] === 'string' ? String(route.query[k]) : '');

const inicio = ref(q('inicio') || iso(VendasDatas.diasAntes(hoje, 29)));
const fim = ref(q('fim') || iso(hoje));

/**
 * HORA é opcional e só vale onde existe hora de verdade: o detalhe do PDV.
 *
 * As duas fontes do relatório diário só têm DATA. Aceitar hora aqui e aplicá-la
 * ao relatório seria fabricar um recorte que a fonte não sustenta; por isso o
 * relatório declara `granularidade: 'dia'` e a tela avisa quando há hora
 * digitada. Quando o robô passar a enviar itens, o detalhe do PDV a honra.
 */
const horaInicio = ref(q('hi'));
const horaFim = ref(q('hf'));
const comHora = computed(() => !!horaInicio.value || !!horaFim.value);
const inicioComHora = computed(() => `${inicio.value}T${horaInicio.value || '00:00'}`);
const fimComHora = computed(() => `${fim.value}T${horaFim.value || '23:59'}`);

/**
 * Filtros por CADASTRO, válidos para a área inteira — com um limite declarado:
 * alcançam só o que sai de ITENS (faturamento, quantidade, produtos, ABC).
 * Número de vendas, pagamentos e ranking de PDV vêm do fechamento de caixa,
 * que não tem itens; filtrar isso por setor exigiria rateio, e rateio é
 * número inventado. A tela diz isso em vez de esconder.
 */
const filtroSetor = ref<string | null>(q('setor') || null);
const filtroGrupo = ref<string | null>(q('grupo') || null);
const filtroProduto = ref(q('produto'));
/** PDV (ID do dispositivo no ERP). Só a aba Vendas usa: é a única com PDV por item. */
const filtroPdv = ref<string | null>(q('pdv') || null);
/** O texto de produto viaja com atraso: cada letra digitada não pode virar uma consulta. */
const filtroProdutoAplicado = ref(filtroProduto.value);
let esperaProduto: ReturnType<typeof setTimeout> | null = null;
watch(filtroProduto, (v) => {
  if (esperaProduto) clearTimeout(esperaProduto);
  esperaProduto = setTimeout(() => { filtroProdutoAplicado.value = v.trim(); }, 400);
});
const filtrosQuery = computed(() => ({
  ...(filtroSetor.value ? { setor: filtroSetor.value } : {}),
  ...(filtroGrupo.value ? { grupo: filtroGrupo.value } : {}),
  ...(filtroProdutoAplicado.value ? { produto: filtroProdutoAplicado.value } : {}),
}));
const filtrosAtivos = computed(() => Object.keys(filtrosQuery.value).length > 0);
/**
 * O recorte que vai para relatório, ranking e ABC: cadastro + hora + PDV. O
 * servidor só aplica hora e PDV quando os cupons cobrem o período e diz
 * quando não aplicou (`fonte.ignorados`).
 */
const recorteQuery = computed(() => ({
  ...filtrosQuery.value,
  ...(horaInicio.value ? { hi: horaInicio.value } : {}),
  ...(horaFim.value ? { hf: horaFim.value } : {}),
  ...(filtroPdv.value ? { pdv: filtroPdv.value } : {}),
}));
function limparFiltros() { filtroSetor.value = null; filtroGrupo.value = null; filtroProduto.value = ''; filtroProdutoAplicado.value = ''; }

/**
 * Período, hora e filtros vivem na URL. É o que faz "voltar" voltar para o
 * mesmo recorte e o que leva o recorte junto para as outras visões de vendas.
 */
const queryAtual = computed(() => ({
  inicio: inicio.value, fim: fim.value,
  ...(horaInicio.value ? { hi: horaInicio.value } : {}),
  ...(horaFim.value ? { hf: horaFim.value } : {}),
  ...filtrosQuery.value,
  ...(filtroPdv.value ? { pdv: filtroPdv.value } : {}),
}));
/*
 * As chaves que ESTA tela controla saem inteiras da URL antes de regravar.
 * Mesclar por cima (`{ ...route.query, ...nova }`) mantinha o valor antigo de
 * um filtro limpo — a hora apagada continuava na URL e voltava ao recarregar.
 */
const CHAVES_DO_RECORTE = ['inicio', 'fim', 'hi', 'hf', 'setor', 'grupo', 'produto', 'pdv'];
watch(queryAtual, (nova) => {
  const resto = Object.fromEntries(Object.entries(route.query).filter(([k]) => !CHAVES_DO_RECORTE.includes(k)));
  router.replace({ query: { ...resto, ...nova } });
}, { deep: true });

const dados = ref<VendasReport | null>(null);
const carregando = ref(false);
const erro = ref('');

/** Aba visível. As três dividem o MESMO período — o filtro fica acima delas. */
const aba = ref<'visao' | 'ranking' | 'vendas' | 'abc' | 'graficos'>((q('aba') as 'visao' | 'ranking' | 'vendas' | 'abc' | 'graficos') || 'visao');

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
      ...recorteQuery.value,
      ...(granularidadeGrafico.value !== 'auto' ? { granularidade: granularidadeGrafico.value } : {}),
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
const granularidadeGrafico = ref<'auto' | 'hora' | 'dia'>('auto');
watch([loja, inicio, fim, filtroSetor, filtroGrupo, filtroProdutoAplicado, horaInicio, horaFim, filtroPdv, granularidadeGrafico], carregar);

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
const pct = (v: number) => VendasFormato.formatarPercentual(v);
/* Ponto é placar, não dinheiro: inteiro. Ver `VendasFormato`. */
const pts = (v: number) => VendasFormato.pontosComUnidade(v);

const resumoCards = computed(() => {
  const r = dados.value?.resumo;
  if (!r) return [];
  // A origem fica escrita no card: faturamento e quantidade vêm das VENDAS por
  // produto; número de vendas e ticket vêm do FECHAMENTO de caixa. São duas
  // fontes e podem divergir — sem dizer isso, o usuário lê como erro de conta.
  const deCupons = dados.value?.fonte.tipo === 'itens';
  if (deCupons) {
    return [
      { label: 'Faturamento', origem: 'cupons do caixa', valor: brl(r.faturamento), icon: 'payments', cor: 'var(--cx-sales-revenue)', corIcone: 'var(--cx-ink)' },
      { label: 'Quantidade vendida', origem: 'cupons do caixa', valor: num(r.quantidade), icon: 'inventory_2', cor: 'var(--cx-sales-volume)' },
      { label: 'Nº de vendas', origem: 'cupons do caixa', valor: num(r.numeroVendas), icon: 'receipt_long', cor: 'var(--cx-sales-revenue)', corIcone: 'var(--cx-ink)' },
      { label: 'Ticket médio', origem: 'cupons do caixa', valor: brl(r.ticketMedio), icon: 'trending_up', cor: 'var(--cx-sales-volume)' },
    ];
  }
  return [
    { label: 'Faturamento', origem: 'vendas por produto', valor: brl(r.faturamento), icon: 'payments', cor: 'var(--cx-sales-revenue)', corIcone: 'var(--cx-ink)' },
    { label: 'Quantidade vendida', origem: 'vendas por produto', valor: num(r.quantidade), icon: 'inventory_2', cor: 'var(--cx-sales-volume)' },
    { label: 'Nº de vendas', origem: 'fechamento de caixa', valor: num(r.numeroVendas), icon: 'receipt_long', cor: 'var(--cx-sales-revenue)', corIcone: 'var(--cx-ink)' },
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

/**
 * Quanto cada forma pesou no período inteiro.
 *
 * A tabela abaixo responde "quanto entrou em pix no dia 3"; esta responde
 * "do que entrou no mês, quanto foi pix" — que é a pergunta de quem negocia
 * taxa de cartão e planeja sangria. A base é a soma das formas, não o
 * faturamento dos produtos: ver `VendasPagamentos`.
 */
const resumoPagamentos = computed(() => VendasPagamentos.resumirPagamentos(
  (dados.value?.pagamentos ?? []) as unknown as Array<Record<string, unknown>>,
  COLUNAS_PAGAMENTO as unknown as Array<{ chave: string; label: string }>,
));

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

/** A cor da forma; as que o gráfico junta em "Outros" ganham tons de cinza. */
const CINZAS_PAGAMENTO = ['#667085', '#8A94A6', '#A7AFBD', '#C3C9D4'];
function corPagamento(chave: string): string {
  const fixa = (CORES_PAGAMENTO as Record<string, string | undefined>)[chave];
  if (fixa) return fixa;
  const resto = COLUNAS_PAGAMENTO.filter((c) => !(c.chave in CORES_PAGAMENTO)).map((c) => c.chave as string);
  const i = resto.indexOf(chave);
  return CINZAS_PAGAMENTO[(i < 0 ? 0 : i) % CINZAS_PAGAMENTO.length]!;
}

/** Cinza recessivo da grade — um passo fora da superfície, nunca tracejado. */
const GRADE = '#E7EAF0';
const TINTA_FRACA = '#6B7280';

const eixoDias = computed(() => (dados.value?.pagamentos ?? []).map((p) => diaCurto(p.data)));
/** Eixo do gráfico grande: hora (`14h`) ou dia (`24/09`), conforme a série. */
const porHora = computed(() => dados.value?.periodo.granularidade === 'hora');
const rotuloT = (t: string) => (t.length > 10 ? `${t.slice(11, 13)}h${eixoSerie.value.length > 24 ? ' ' + diaCurto(t.slice(0, 10)) : ''}` : diaCurto(t));
const eixoSerie = computed(() => (dados.value?.serie ?? []).map((p) => p.t));
const rotuloCompleto = (t: string) => (t.length > 10 ? `${dia(t.slice(0, 10))} ${t.slice(11, 16)}` : dia(t));

/**
 * A MEDIDA do gráfico grande.
 *
 * Duas medidas, um eixo de cada vez — nunca as duas juntas. Dinheiro e
 * contagem de vendas têm escalas diferentes; sobrepor as duas num gráfico com
 * dois eixos é o erro mais comum de painel, porque o cruzamento das linhas
 * vira uma coincidência de escala que parece significado.
 */
const MEDIDAS = [
  { valor: 'total', label: 'Faturamento', sufixo: 'R$' },
  { valor: 'numeroVendas', label: 'Nº de vendas', sufixo: '' },
] as const;
const medida = ref<'total' | 'numeroVendas'>('total');
const medidaAtual = computed(() => MEDIDAS.find((m) => m.valor === medida.value)!);

const serieGrande = computed(() => [{
  name: medidaAtual.value.label,
  data: (dados.value?.serie ?? []).map((p) => Number(p[medida.value])),
}]);

const temSerie = computed(() => (dados.value?.serie ?? []).length > 0);

/** O maior dia do período — é o único ponto que ganha rótulo direto. */
const pico = computed(() => {
  const linhas = dados.value?.serie ?? [];
  if (!linhas.length) return null;
  let melhor = linhas[0]!;
  for (const l of linhas) if (Number(l[medida.value]) > Number(melhor[medida.value])) melhor = l;
  return { data: melhor.t, valor: Number(melhor[medida.value]) };
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
  colors: ['#f3fb05'], // amarelo de faturamento, mesma paleta dos tokens --cx-sales-*
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
    categories: eixoSerie.value.map(rotuloT),
    tickAmount: Math.min(12, eixoSerie.value.length),
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
    x: { formatter: (_v, o) => rotuloCompleto(dados.value?.serie?.[o?.dataPointIndex ?? 0]?.t ?? '') },
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
      inicio: inicioComHora.value,
      fim: fimComHora.value,
      ordenar: ordemPdv.value,
    });
    if (pedido === pedidoDetalhe) detalhePdv.value = resposta;
  } catch (e: unknown) {
    if (pedido === pedidoDetalhe) erroDetalhe.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar os itens deste PDV.';
  } finally {
    if (pedido === pedidoDetalhe) carregandoDetalhe.value = false;
  }
}
watch([pdvAberto, ordemPdv, horaInicio, horaFim], carregarDetalhePdv);

/**
 * Gráfico do PDV por HORA ou por DIA. O toggle só aparece quando há itens com
 * hora — é o único lugar da área em que a fonte sustenta a granularidade.
 */
const granularidadePdv = ref<'hora' | 'dia'>('hora');
const seriePdvTempo = computed(() => {
  const pontos = detalhePdv.value?.porHora ?? [];
  if (granularidadePdv.value === 'hora') {
    return { categorias: pontos.map((p) => p.hora.slice(11, 16) + (pontos.length > 24 ? ' ' + p.hora.slice(8, 10) + '/' + p.hora.slice(5, 7) : '')), valores: pontos.map((p) => p.faturamento ?? p.quantidade) };
  }
  const porDia = new Map<string, number>();
  for (const p of pontos) porDia.set(p.hora.slice(0, 10), (porDia.get(p.hora.slice(0, 10)) ?? 0) + (p.faturamento ?? p.quantidade));
  return { categorias: [...porDia.keys()].map(diaCurto), valores: [...porDia.values()] };
});
const opcoesPdvTempo = computed<ApexOptions>(() => ({
  chart: { toolbar: { show: false }, animations: { enabled: false } },
  colors: ['#f3fb05'], // amarelo de faturamento, mesma paleta dos tokens --cx-sales-*
  dataLabels: { enabled: false },
  plotOptions: { bar: { borderRadius: 3, columnWidth: '60%' } },
  xaxis: { categories: seriePdvTempo.value.categorias, labels: { rotate: -45, style: { fontSize: '11px' } } },
  yaxis: { labels: { formatter: (v: number) => (detalhePdv.value?.faturamentoItens === null ? num(v) : brl(v)) } },
  tooltip: { y: { formatter: (v: number) => (detalhePdv.value?.faturamentoItens === null ? num(v) : brl(v)) } },
}));
watch([loja, inicio, fim, filtroSetor, filtroGrupo, filtroProdutoAplicado], () => { pdvAberto.value = null; });

/* ===================== VENDAS AO VIVO ===================== */

/**
 * Uma linha por cupom, como saiu do caixa.
 *
 * Só existe sobre `venda_item_pdv` — a tabela em que cada item traz o ID da
 * venda, o dispositivo e a hora, comprovados pelo ERP. Até o robô da loja
 * mandar esse detalhe, a aba diz "aguardando" em vez de inventar cupom a partir
 * das tabelas diárias, que não sabem o que é uma venda.
 *
 * "Ao vivo" aqui é reler a cada INTERVALO_AO_VIVO segundos enquanto a aba está
 * aberta. A latência real é do robô: se ele roda a cada minuto, o cupom aparece
 * em até um minuto; se roda às 22:10, aparece às 22:10.
 */
const INTERVALO_AO_VIVO = 15;
const listaVendas = ref<ListaVendas | null>(null);
const carregandoLista = ref(false);
const erroLista = ref('');
const paginaVendas = ref(1);
const ultimaLeitura = ref<Date | null>(null);
let relogioAoVivo: ReturnType<typeof setInterval> | null = null;
let pedidoLista = 0;

async function carregarLista(silencioso = false) {
  const pedido = ++pedidoLista;
  if (!silencioso) carregandoLista.value = true;
  erroLista.value = '';
  try {
    const r = await api.vendasLista({
      ...(isAdmin.value ? { loja: loja.value } : {}),
      inicio: inicioComHora.value,
      fim: fimComHora.value,
      ...filtrosQuery.value,
      ...(filtroPdv.value ? { dispositivoIdErp: filtroPdv.value } : {}),
      limite: 50,
      pagina: paginaVendas.value,
    });
    if (pedido !== pedidoLista) return; // resposta velha: uma mais nova já saiu
    listaVendas.value = r;
    ultimaLeitura.value = new Date();
  } catch (e: unknown) {
    if (pedido === pedidoLista) {
      erroLista.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar as vendas.';
    }
  } finally {
    if (pedido === pedidoLista) carregandoLista.value = false;
  }
}

const aoVivo = computed(() => aba.value === 'vendas');
watch(aoVivo, (ligado) => {
  if (relogioAoVivo) { clearInterval(relogioAoVivo); relogioAoVivo = null; }
  if (!ligado) return;
  void carregarLista();
  // recarga silenciosa: não pisca o carregando a cada ciclo, senão a tela treme
  relogioAoVivo = setInterval(() => { void carregarLista(true); }, INTERVALO_AO_VIVO * 1000);
}, { immediate: true });
onBeforeUnmount(() => { if (relogioAoVivo) clearInterval(relogioAoVivo); });

watch(loja, () => { filtroPdv.value = null; }); // PDV de uma loja não existe na outra
watch([loja, inicio, fim, horaInicio, horaFim, filtroSetor, filtroGrupo, filtroProdutoAplicado, filtroPdv], () => {
  paginaVendas.value = 1;
  if (aoVivo.value) void carregarLista();
});
watch(paginaVendas, () => { if (aoVivo.value) void carregarLista(); });
watch(aba, (a) => { router.replace({ query: { ...route.query, aba: a } }); });

const paginasVendas = computed(() => listaVendas.value ? Math.max(1, Math.ceil(listaVendas.value.total / listaVendas.value.limite)) : 1);
const horaDe = (s: string) => s.slice(11, 19);
const diaHoraDe = (s: string) => `${diaCurto(s.slice(0, 10))} ${s.slice(11, 19)}`;
const horaLocal = (d: Date) => d.toLocaleTimeString('pt-BR');

/** O cupom aberto: os itens vêm por chamada própria, só quando alguém clica. */
const vendaAberta = ref<VendaResumo | null>(null);
const vendaDetalhe = ref<VendaDetalhe | null>(null);
const carregandoVenda = ref(false);
const erroVenda = ref('');
watch(vendaAberta, async (v) => {
  vendaDetalhe.value = null;
  erroVenda.value = '';
  if (!v) return;
  carregandoVenda.value = true;
  try {
    vendaDetalhe.value = await api.vendasVenda({ ...(isAdmin.value ? { loja: loja.value } : {}), vendaIdErp: v.vendaIdErp });
  } catch (e: unknown) {
    erroVenda.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível abrir esta venda.';
  } finally {
    carregandoVenda.value = false;
  }
});

async function carregarRanking() {
  carregandoRanking.value = true;
  erroRanking.value = '';
  try {
    ranking.value = await api.vendasRanking({
      ...recorteQuery.value,
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
/*
 * `immediate`: a aba agora vem da URL (`?aba=ranking`). Sem isso, abrir a
 * página já nela não disparava a carga — a watch só reage a MUDANÇA de aba.
 * E os filtros entram na lista: antes trocar setor ou PDV não relia o ranking.
 */
watch([aba, dimensao, loja, inicio, fim, filtroSetor, filtroGrupo, filtroProdutoAplicado, horaInicio, horaFim, filtroPdv], () => {
  if (aba.value === 'ranking') carregarRanking();
}, { immediate: true });

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
/* A em amarelo e B em azul: os mesmos vivos dos tokens --cx-sales-*; C fica neutro. */
const CORES_ABC = { A: '#f3fb05', B: '#0595fb', C: '#6B7280' } as const;

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
      ...recorteQuery.value,
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
watch([aba, classeAberta, loja, inicio, fim, filtroSetor, filtroGrupo, filtroProdutoAplicado, horaInicio, horaFim, filtroPdv], () => {
  if (aba.value === 'abc') carregarListaAbc();
}, { immediate: true }); // abrir direto em ?aba=abc também carrega

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
  // 'risco' (dias de estoque) desligada por ora: sem saldo, mín e máx no cadastro ela não diz nada
] as const;
const ordem = ref<'faturamento' | 'giro' | 'risco'>('faturamento');
// filtroSetor / filtroGrupo / filtroProduto: declarados no topo, valem para a área inteira
/**
 * As OPÇÕES de setor e grupo saem de uma leitura SEM filtro, própria.
 *
 * Tirá-las da lista ABC exibida tinha dois defeitos: ela só carrega na aba ABC
 * (os selects da barra ficavam vazios nas outras abas) e já vem filtrada — ao
 * escolher um setor, os demais sumiam do dropdown e não dava para trocar.
 */
const baseOpcoes = ref<AbcProdutos | null>(null);
const opcoesPdv = ref<Array<{ dispositivoIdErp: string; pdv: string }>>([]);
async function carregarOpcoesCadastro() {
  const lojaQ = isAdmin.value ? { loja: loja.value } : {};
  try {
    baseOpcoes.value = await api.vendasCurvaAbc({ ...lojaQ, inicio: inicio.value, fim: fim.value });
  } catch { baseOpcoes.value = null; }
  try {
    // a lista devolve os PDVs que venderam no período; basta uma linha dela
    opcoesPdv.value = (await api.vendasLista({ ...lojaQ, inicio: `${inicio.value}T00:00`, fim: `${fim.value}T23:59`, limite: 1, pagina: 1 })).pdvs;
  } catch { opcoesPdv.value = []; }
}
onMounted(carregarOpcoesCadastro);
watch([loja, inicio, fim], carregarOpcoesCadastro);
const setoresAbc = computed(() => [...new Set((baseOpcoes.value?.itens ?? []).map((i) => i.setor).filter((v): v is string => !!v))].sort());
const gruposAbc = computed(() => [...new Set((baseOpcoes.value?.itens ?? []).map((i) => i.grupo).filter((v): v is string => !!v))].sort());
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
/*
 * A lista ABC não pagina mais (decisão do José em 06/10/2026). Paginar de 25
 * em 25 quebrava justamente a leitura que a curva pede: correr o olho do
 * primeiro ao último e ver onde o acumulado passa de 80%. O servidor já
 * devolvia tudo; a fatia era só da tela.
 *
 * Em troca, a tabela ganha altura máxima com rolagem própria e cabeçalho
 * fixo — milhares de linhas soltas na página empurrariam o rodapé para longe.
 */

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
      <v-text-field
        v-model="horaInicio"
        type="time"
        label="Hora de"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        style="max-width: 150px"
      />
      <v-text-field
        v-model="horaFim"
        type="time"
        label="Hora até"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        style="max-width: 150px"
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
      <!--
        `min-width` importa: sem ele o flex encolhia os selects a 60px no canto
        da barra e o rótulo virava uma letra. Com largura mínima eles quebram
        para a linha de baixo inteiros, em vez de caberem espremidos.
      -->
      <v-select v-model="filtroSetor" :items="setoresAbc" label="Setor" clearable variant="outlined" density="compact" hide-details style="min-width: 190px; max-width: 240px" />
      <v-select v-model="filtroGrupo" :items="gruposAbc" label="Grupo" clearable variant="outlined" density="compact" hide-details style="min-width: 190px; max-width: 240px" />
      <v-text-field v-model="filtroProduto" label="Produto ou código" prepend-inner-icon="search" clearable variant="outlined" density="compact" hide-details style="min-width: 220px; max-width: 260px" />
      <v-select
        v-model="filtroPdv"
        :items="opcoesPdv"
        item-title="pdv"
        item-value="dispositivoIdErp"
        label="PDV"
        prepend-inner-icon="point_of_sale"
        clearable
        variant="outlined"
        density="compact"
        hide-details
        style="min-width: 200px; max-width: 260px"
      />
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">Atualizar</v-btn>
      <v-btn variant="tonal" prepend-icon="list" :to="{ path: '/vendas/produtos', query: queryAtual }">Produtos vendidos</v-btn>
      <v-btn variant="tonal" prepend-icon="leaderboard" color="primary" :to="{ path: '/vendas/painel', query: queryAtual }">Painel de setores</v-btn>
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
        <v-tab value="vendas" prepend-icon="receipt_long">Vendas</v-tab>
        <v-tab value="abc" prepend-icon="donut_large">Curva ABC</v-tab>
        <v-tab value="graficos" prepend-icon="bar_chart">Gráficos</v-tab>
      </v-tabs>

      <v-alert v-if="semMovimento" type="info" variant="tonal" class="mb-4">
        Nenhuma venda registrada nesse período para esta loja.
      </v-alert>

      <v-window v-else v-model="aba">
        <!-- ─────────────────────────────────────────────── VISÃO GERAL ── -->
        <v-window-item value="visao">
          <!--
            Dois avisos que existem para a tela não mentir: o relatório é por
            DIA (a fonte só tem data, hora vale no detalhe do PDV) e o filtro
            de cadastro só alcança o que sai de itens.
          -->
          <v-alert v-if="dados.fonte.ignorados.length" type="warning" variant="tonal" density="compact" class="mb-3" icon="schedule">
            <strong>{{ dados.fonte.ignorados.includes('hora') && dados.fonte.ignorados.includes('pdv') ? 'Hora e PDV foram ignorados' : dados.fonte.ignorados.includes('hora') ? 'A hora foi ignorada' : 'O PDV foi ignorado' }}</strong>
            neste período: ele começa antes de <strong>{{ dados.fonte.desde ? dia(dados.fonte.desde) : '—' }}</strong>, o primeiro dia com cupons
            detalhados. Os números abaixo são os totais diários. Para usar hora e PDV, comece o período nessa data ou depois.
          </v-alert>
          <v-alert v-if="dados.filtros.ativo && dados.filtros.alcance === 'itens'" type="info" variant="tonal" density="compact" class="mb-3" icon="filter_alt">
            Filtro por cadastro ativo — vale para faturamento, quantidade, produtos e curva ABC.
            <strong>Nº de vendas, ticket médio e ranking de caixas não filtram</strong> neste período (totais diários, sem itens).
            <v-btn size="x-small" variant="text" class="ml-2" @click="limparFiltros">Limpar</v-btn>
          </v-alert>
          <v-row class="mb-1">
            <v-col v-for="c in resumoCards" :key="c.label" cols="12" sm="6" md="3">
              <v-card flat border rounded="lg" class="pa-4 h-100">
                <div class="d-flex align-center ga-3">
                  <!-- ícone escuro sobre o amarelo vivo: branco sobre #FBBC05 não se lê -->
                  <v-avatar :color="c.cor" size="46" rounded="lg" variant="flat">
                    <v-icon :color="c.corIcone ?? 'white'">{{ c.icon }}</v-icon>
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
                <div class="text-subtitle-1 font-weight-bold">{{ medidaAtual.label }} por {{ porHora ? 'hora' : 'dia' }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ dia(dados.periodo.inicio) }} a {{ dia(dados.periodo.fim) }} ·
                  {{ dados.fonte.tipo === 'itens' ? 'cupons do caixa' : 'fechamento de caixa' }}
                </div>
              </div>
              <v-spacer />
              <!--
                Uma medida de cada vez, num eixo só. Dinheiro e contagem de
                vendas têm escalas diferentes: sobrepor as duas com dois eixos
                faz o cruzamento das linhas parecer significado quando é só
                coincidência de escala.
              -->
              <!-- hora só existe com os cupons: no diário o botão nem aparece -->
              <v-btn-toggle
                v-if="dados.fonte.tipo === 'itens'"
                :model-value="porHora ? 'hora' : 'dia'"
                density="compact"
                variant="outlined"
                divided
                mandatory
                @update:model-value="(v: 'hora' | 'dia') => { granularidadeGrafico = v; }"
              >
                <v-btn value="hora" size="small">Por hora</v-btn>
                <v-btn value="dia" size="small">Por dia</v-btn>
              </v-btn-toggle>
              <v-btn-toggle v-model="medida" density="compact" variant="outlined" divided mandatory>
                <v-btn v-for="m in MEDIDAS" :key="m.valor" :value="m.valor" size="small">{{ m.label }}</v-btn>
              </v-btn-toggle>
            </div>

            <div v-if="!temSerie" class="text-caption text-medium-emphasis py-8 text-center">
              Nenhuma venda neste recorte.
            </div>
            <template v-else>
              <!-- rótulo direto só no PICO: número em todo ponto não se lê -->
              <div v-if="pico" class="text-caption text-medium-emphasis mb-2">
                {{ porHora ? 'Maior hora' : 'Maior dia' }}: <strong class="text-high-emphasis">{{ rotuloCompleto(pico.data) }}</strong>
                — {{ formatarMedida(pico.valor) }}
              </div>
              <!-- sem altura fixa no container: a altura vive nas opções, e é o
                   que mantém a faixa do eixo X DENTRO do cartão -->
              <apexchart type="area" :height="420" :options="opcoesGrande" :series="serieGrande" />
            </template>
          </v-card>

          <div v-if="dados.fonte.tipo === 'itens'" class="text-caption text-medium-emphasis mt-3">
            Todos os números acima saem dos cupons do caixa (itens confirmados, sem cancelados).
            O fechamento de caixa pode diferir: ele inclui crediário, sobra/perda e outros lançamentos que não são venda de produto.
          </div>
          <div v-else class="text-caption text-medium-emphasis mt-3">
            O faturamento sai das vendas por produto e o número de vendas sai do fechamento
            de caixa. São registros diferentes do PDV, então os totais podem não bater:
            o fechamento inclui crediário, sobra/perda e outros lançamentos que não são venda de produto.
          </div>

          <v-card flat border rounded="lg" class="pa-4 mt-4">
            <div class="d-flex align-center flex-wrap ga-2 mb-2">
              <div class="text-subtitle-1 font-weight-bold">Margem e lucro bruto</div>
              <v-spacer />
              <v-btn size="small" variant="tonal" :to="{ path: '/vendas/de-para', query: queryAtual }">Resolver produtos sem custo</v-btn>
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
                  <NuxtLink :to="{ path: '/vendas/de-para', query: queryAtual }" class="text-primary">Resolver no de-para</NuxtLink>.
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
                    <div class="text-caption text-medium-emphasis">{{ pts(i.pontos) }}</div>
                  </div>
                </div>
                <!-- barra proporcional ao LÍDER: compara dentro da própria lista -->
                <v-progress-linear
                  :model-value="fatiaDoLider(i.pontos)"
                  :color="i.posicao === 1 ? '#f3fb05' : 'grey-lighten-1'"
                  height="4"
                  rounded
                  class="mt-1"
                />
              </div>

              <div v-if="ranking.itens.length" class="text-caption text-medium-emphasis mt-4">
                Pontuação = faturamento × 25%. Total do período:
                <strong class="text-high-emphasis">{{ pts(ranking.pontosTotal) }}</strong>.
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
              </div>
              <div class="text-caption text-medium-emphasis mb-3">
                {{ num(itensAbcOrdenados.length) }} produto(s) nesta lista após os filtros.
                Setor, grupo e produto vêm da barra acima e recalculam a curva sobre o recorte: a classe A aqui é a A DENTRO do filtro.
              </div>
              <!--
                O AVISO vem antes da tabela, de propósito.

                O sistema NÃO guarda saldo de estoque — nem no banco nem na
                planilha (a aba de estoque é um formulário de contagem mensal,
                com a coluna de quantidade em branco). Então "dias de máximo" é
                o TETO, não o que resta hoje. Sem esta frase, alguém leria "3,3
                dias" como "acaba quinta-feira" e compraria errado.
              -->

              <div
                v-if="listaAbc.semCadastro"
                class="text-caption text-medium-emphasis mb-3"
              >
                <template v-if="listaAbc.semCadastro">
                  <strong class="text-warning">{{ num(listaAbc.semCadastro) }}</strong>
                  produto(s) desta classe não casaram com o cadastro — sem setor nem custo.
                  <NuxtLink :to="{ path: '/vendas/de-para', query: queryAtual }" class="text-primary">Resolver no de-para</NuxtLink>.
                </template>
              </div>

              <div v-if="!itensAbcOrdenados.length" class="text-caption text-medium-emphasis py-8 text-center">
                Nenhum produto nesta classe no período.
              </div>

              <div v-else class="sales-abc-lista">
                <v-table density="compact" fixed-header height="100%">
                  <thead>
                    <tr>
                      <th class="text-left">Posição</th>
                      <th class="text-left">Produto</th>
                      <th class="text-left">Setor</th>
                      <th class="text-right">Vendeu</th>
                      <th class="text-right">Por dia</th>
                      <th class="text-right">Faturou</th>
                      <th class="text-right">% do fat.</th>
                      <th class="text-right">% acum.</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="i in itensAbcOrdenados" :key="`${i.produtoCodigo}-${i.produto}`" :class="{ 'sales-abc-a': i.classe === 'A' }">
                      <!--
                        1/n: n é quantos produtos DIFERENTES venderam no recorte.
                        A porcentagem é a posição dentro desse universo — "1/100,
                        top 1%" — e diz mais que o número solto.
                      -->
                      <td class="tabular text-no-wrap">
                        <div class="font-weight-medium">{{ i.posicao }}/{{ listaAbc.totalProdutos }}</div>
                        <div class="text-caption text-medium-emphasis">top {{ pct((i.posicao / Math.max(1, listaAbc.totalProdutos)) * 100) }}</div>
                      </td>
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
                      <td class="text-right">{{ pct(i.participacao) }}</td>
                      <td class="text-right text-medium-emphasis">{{ pct(i.acumulado) }}</td>
                    </tr>
                  </tbody>
                </v-table>
              </div>

              <div class="text-caption text-medium-emphasis mt-3">
                Período de {{ num(listaAbc.periodo.dias) }} dia(s).
                <strong>Por dia</strong> é a venda média no período — é o ritmo que consome a prateleira.
                A lista mostra os {{ num(itensAbcOrdenados.length) }} produtos da classe, sem paginar;
                <strong>% do fat.</strong> é o peso do produto e <strong>% acum.</strong> é a soma até ele.
              </div>
            </template>
          </v-card>
        </v-window-item>

        <!-- ──────────────────────────────────────────────── RELATÓRIOS ── -->

        <!-- ────────────────────────────────────────────────── GRÁFICOS ── -->
        <v-window-item value="vendas">
          <v-card flat border rounded="lg" class="pa-4">
            <div class="d-flex align-center flex-wrap ga-3 mb-3">
              <div>
                <div class="text-subtitle-1 font-weight-bold d-flex align-center ga-2">
                  Vendas do período
                  <span class="ao-vivo" :class="{ ligado: aoVivo && !erroLista }" aria-hidden="true" />
                  <span class="text-caption text-medium-emphasis font-weight-regular">
                    {{ erroLista ? 'sem conexão' : `ao vivo · relê a cada ${INTERVALO_AO_VIVO}s` }}
                  </span>
                </div>
                <div class="text-caption text-medium-emphasis">
                  Uma linha por cupom, com hora e PDV comprovados pelo ERP.
                  <template v-if="ultimaLeitura"> Lida às {{ horaLocal(ultimaLeitura) }}.</template>
                  <template v-if="listaVendas?.atualizadoEm"> Última venda recebida do robô: {{ diaHoraDe(listaVendas.atualizadoEm) }}.</template>
                </div>
              </div>
              <v-spacer />
              <v-btn size="small" variant="tonal" prepend-icon="refresh" :loading="carregandoLista" @click="carregarLista()">Atualizar agora</v-btn>
            </div>

            <v-alert v-if="erroLista" type="error" variant="tonal" density="compact" class="mb-3">{{ erroLista }}</v-alert>

            <!--
              Ausência de dado, dita como ausência: as tabelas diárias não sabem o
              que é "uma venda". Sem o lote detalhado do robô, não há o que listar
              — e listar cupons inventados seria pior do que uma lista vazia.
            -->
            <v-alert v-if="listaVendas && !listaVendas.disponivel" type="info" variant="tonal" icon="hourglass_empty">
              <strong>Aguardando o robô da loja.</strong> Esta lista precisa do detalhe por venda
              (lote <code>venda_item_pdv</code>), que o robô instalado na padaria ainda não envia.
              Quando ele passar a enviar, cada cupom aparece aqui em até um ciclo do robô.
            </v-alert>

            <template v-else-if="listaVendas">
              <div v-if="listaVendas.filtros.ativo" class="text-caption text-medium-emphasis mb-2">
                Filtro por cadastro ativo: entram as vendas com ao menos um item que passa no filtro.
              </div>
              <div v-if="!listaVendas.vendas.length" class="text-caption text-medium-emphasis py-8 text-center">
                Nenhuma venda neste recorte.
              </div>
              <div v-else class="tabela-rolavel">
                <table class="tabela-vendas">
                  <thead>
                    <tr>
                      <th>Hora</th><th>Venda</th><th>PDV</th>
                      <th class="num">Itens</th><th class="num">Qtd.</th><th class="num">Total</th><th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="v in listaVendas.vendas"
                      :key="v.vendaIdErp"
                      class="venda-linha"
                      :class="{ cancelada: v.cancelada }"
                      tabindex="0"
                      role="button"
                      :aria-label="`Abrir venda ${v.vendaIdErp}`"
                      @click="vendaAberta = v"
                      @keydown.enter="vendaAberta = v"
                    >
                      <td class="tabular"><span class="font-weight-medium">{{ horaDe(v.vendidoEm) }}</span> <span class="text-caption text-medium-emphasis">{{ diaCurto(v.vendidoEm.slice(0, 10)) }}</span></td>
                      <td class="tabular">#{{ v.vendaIdErp }}</td>
                      <td>{{ v.pdv || `dispositivo ${v.dispositivoIdErp}` }}</td>
                      <td class="num tabular">{{ v.itens }}</td>
                      <td class="num tabular sales-volume">{{ num(v.quantidade) }}</td>
                      <td class="num tabular sales-revenue font-weight-bold">{{ v.total === null ? 'Restrito' : brl(v.total) }}</td>
                      <td>
                        <v-chip v-if="v.cancelada" size="x-small" color="error" variant="tonal">cancelada</v-chip>
                        <v-chip v-else-if="!v.confirmada" size="x-small" color="warning" variant="tonal">{{ v.status || 'em aberto' }}</v-chip>
                        <v-chip v-else size="x-small" color="success" variant="tonal">confirmada</v-chip>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="paginasVendas > 1" class="d-flex align-center justify-space-between flex-wrap ga-2 mt-3">
                <span class="text-caption text-medium-emphasis">{{ num(listaVendas.total) }} venda(s) · página {{ listaVendas.pagina }} de {{ paginasVendas }}</span>
                <v-pagination v-model="paginaVendas" :length="paginasVendas" density="compact" total-visible="7" />
              </div>
            </template>
          </v-card>
        </v-window-item>

        <v-window-item value="graficos">
          <v-alert type="info" variant="tonal" density="compact" class="mb-3" icon="info">
            As <strong>formas de pagamento</strong> vêm do fechamento de caixa, que é um total por dia:
            respeitam as datas, mas não a hora, o PDV nem os filtros de cadastro.
          </v-alert>
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
              <!-- o peso de cada forma no período, antes do dia a dia -->
              <div v-if="resumoPagamentos.itens.length" class="sales-pag-resumo mt-4">
                <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-2">
                  <div class="text-subtitle-2 font-weight-bold">Peso de cada forma no período</div>
                  <div class="text-caption text-medium-emphasis">Base: {{ brl(resumoPagamentos.total) }} somando as formas</div>
                </div>
                <div class="sales-pag-barra" role="img" aria-label="Participação de cada forma de pagamento">
                  <span
                    v-for="f in resumoPagamentos.itens"
                    :key="f.chave"
                    :style="{ width: `${Math.max(0, f.percentual)}%`, background: corPagamento(f.chave) }"
                    :title="`${f.label}: ${pct(f.percentual)}`"
                  />
                </div>
                <div class="sales-pag-grade mt-3">
                  <div v-for="f in resumoPagamentos.itens" :key="f.chave" class="sales-pag-item">
                    <span class="sales-pag-ponto" :style="{ background: corPagamento(f.chave) }" />
                    <div class="flex-grow-1">
                      <div class="text-body-2 font-weight-medium">{{ f.label }}</div>
                      <div class="text-caption text-medium-emphasis">{{ brl(f.total) }}</div>
                    </div>
                    <div class="text-body-2 font-weight-bold tabular">{{ pct(f.percentual) }}</div>
                  </div>
                </div>
                <div v-if="resumoPagamentos.itens.some((f) => f.percentual < 0)" class="text-caption text-medium-emphasis mt-2">
                  Há ajuste negativo no período (roubo/furto ou sobra/perda), então as fatias passam de 100%.
                </div>
              </div>

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

    <v-dialog :model-value="vendaAberta !== null" max-width="640" @update:model-value="v => { if (!v) vendaAberta = null; }">
      <v-card v-if="vendaAberta" rounded="lg" class="pa-5">
        <div class="d-flex align-start ga-3 mb-3">
          <div>
            <div class="text-h6 font-weight-bold">Venda #{{ vendaAberta.vendaIdErp }}</div>
            <div class="text-caption text-medium-emphasis">
              {{ diaHoraDe(vendaAberta.vendidoEm) }} · {{ vendaAberta.pdv || `dispositivo ${vendaAberta.dispositivoIdErp}` }}
              <v-chip v-if="vendaAberta.cancelada" size="x-small" color="error" variant="tonal" class="ml-1">cancelada</v-chip>
            </div>
          </div>
          <v-spacer />
          <v-btn icon="close" variant="text" aria-label="Fechar venda" @click="vendaAberta = null" />
        </div>

        <v-progress-linear v-if="carregandoVenda" indeterminate color="primary" class="mb-3" />
        <v-alert v-if="erroVenda" type="error" variant="tonal" density="compact">{{ erroVenda }}</v-alert>

        <template v-if="vendaDetalhe">
          <div class="tabela-rolavel">
            <table class="tabela-vendas">
              <thead><tr><th>Produto</th><th class="num">Qtd.</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead>
              <tbody>
                <tr v-for="i in vendaDetalhe.itens" :key="i.itemIdErp" :class="{ cancelada: i.cancelado }">
                  <td>
                    <div class="font-weight-medium">{{ i.produto }}</div>
                    <div class="text-caption text-medium-emphasis">
                      {{ i.produtoCodigo || 'sem código' }}
                      <template v-if="i.produtoCadastro"> · cadastro: {{ i.produtoCadastro }}</template>
                      <span v-else class="text-warning"> · fora do cadastro</span>
                      <span v-if="i.cancelado"> · cancelado</span>
                    </div>
                  </td>
                  <td class="num tabular sales-volume">{{ num(i.quantidade) }}</td>
                  <td class="num tabular">{{ i.valorUnitario === null ? '—' : brl(i.valorUnitario) }}</td>
                  <td class="num tabular sales-revenue">{{ i.total === null ? '—' : brl(i.total) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr><td colspan="3" class="text-right font-weight-bold">Total da venda</td><td class="num tabular sales-revenue font-weight-bold">{{ vendaDetalhe.total === null ? 'Restrito' : brl(vendaDetalhe.total) }}</td></tr>
              </tfoot>
            </table>
          </div>
        </template>
      </v-card>
    </v-dialog>

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
        <div v-if="detalhePdv?.porHora?.length" class="mb-4">
          <div class="d-flex align-center flex-wrap ga-2 mb-2">
            <div class="text-subtitle-2 font-weight-bold">{{ detalhePdv.faturamentoItens === null ? 'Quantidade' : 'Faturamento' }} por {{ granularidadePdv }}</div>
            <v-spacer />
            <v-btn-toggle v-model="granularidadePdv" density="compact" variant="outlined" divided mandatory>
              <v-btn value="hora" size="small">Por hora</v-btn>
              <v-btn value="dia" size="small">Por dia</v-btn>
            </v-btn-toggle>
          </div>
          <apexchart type="bar" :height="220" :options="opcoesPdvTempo" :series="[{ name: granularidadePdv === 'hora' ? 'Por hora' : 'Por dia', data: seriePdvTempo.valores }]" />
        </div>
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
/* ponto "ao vivo": pulsa só enquanto a leitura está ligada e saudável */
.ao-vivo { width: 8px; height: 8px; border-radius: 50%; background: var(--cx-ink-faint); display: inline-block; }
.ao-vivo.ligado { background: var(--cx-sales-volume); animation: pulsar 1.6s ease-in-out infinite; }
@keyframes pulsar { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

.tabela-rolavel { overflow-x: auto; }
.tabela-vendas { width: 100%; border-collapse: collapse; }
.tabela-vendas th { text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--cx-ink-soft); padding: 8px 10px; border-bottom: 1px solid var(--cx-line); white-space: nowrap; }
.tabela-vendas td { padding: 10px; border-bottom: 1px solid var(--cx-line-soft); vertical-align: middle; }
.tabela-vendas .num { text-align: right; }
.tabela-vendas tfoot td { border-bottom: 0; border-top: 1px solid var(--cx-line); }
.venda-linha { cursor: pointer; transition: background 120ms var(--cx-ease); }
.venda-linha:hover, .venda-linha:focus-visible { background: var(--cx-surface-sunken); outline: none; }
.tabela-vendas tr.cancelada td { opacity: 0.55; text-decoration: line-through; }
.tabela-vendas tr.cancelada td:last-child { text-decoration: none; }

.sales-abc-a { background: var(--cx-sales-revenue-wash); }
.sales-abc-a td:first-child { border-left: 3px solid var(--cx-sales-revenue); }
/* Texto usa a face `-ink`: o amarelo vivo de preenchimento não se lê sobre branco. */
.sales-profit { color: var(--cx-sales-profit-ink); }
.sales-volume { color: var(--cx-sales-volume-ink); }
.sales-revenue { color: var(--cx-sales-revenue-ink); }
.sales-rank-row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-top: 1px solid var(--cx-line-soft); }
.sales-pdv-link { text-transform: none; padding-inline: 0; max-width: 100%; }
.sales-pdv-products { max-height: 360px; overflow-y: auto; }
.sales-abc-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
/* Lista ABC inteira: rolagem própria e cabeçalho fixo, para a página não crescer sem fim. */
.sales-abc-lista { max-height: min(70vh, 620px); overflow: auto; border: 1px solid var(--cx-line-soft); border-radius: 8px; }
.sales-pag-barra { display: flex; width: 100%; height: 14px; border-radius: 999px; overflow: hidden; background: var(--cx-surface-sunken); }
.sales-pag-barra span { display: block; height: 100%; min-width: 2px; }
.sales-pag-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 20px; }
.sales-pag-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--cx-line-soft); }
.sales-pag-ponto { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
@media (max-width: 700px) { .sales-abc-filters { grid-template-columns: 1fr; } }
</style>
