<script setup lang="ts">
import { useDisplay } from 'vuetify';
import { ProductRules } from '@pralis/shared';
import type { ProductSchemas } from '@pralis/shared';

type Product = ProductSchemas.ProductEntity;

const api = useApi();
const { user } = useAuth();
const flash = useFlash();
// aviso vindo do formulário (ex.: espelhamento na planilha pendente)
const mostrarFlash = computed({
  get: () => !!flash.value,
  set: (v: boolean) => { if (!v) flash.value = null; },
});
// A paginação com número fixo de botões estourava a largura no celular e
// criava rolagem horizontal na lista. O total visível acompanha a tela.
const { xs, smAndDown } = useDisplay();
const paginasVisiveis = computed(() => (xs.value ? 3 : smAndDown.value ? 4 : 6));

const products = ref<Product[]>([]);
const search = ref('');
const loading = ref(false);
const erro = ref('');
const statusEmAlteracao = ref<Set<string>>(new Set());
const fotoAberta = ref<{ url: string; nome: string } | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;
/**
 * Assinatura da última lista recebida. O polling só substitui os dados quando
 * ALGO mudou de verdade: trocar o array a cada 5s re-renderiza 10 cards embaixo
 * do cursor de quem está lendo e faz o navegador reposicionar a rolagem.
 */
let assinatura = '';

// Admin enxerga o catálogo Geral (BASE) e o de cada loja; usuário comum só a própria loja.
const isAdmin = computed(() => user.value?.role === 'admin');
const abas = [
  { key: 'BASE', label: 'Geral (Base)' },
  { key: 'TNP', label: 'TNP' },
  { key: 'LI', label: 'LI' },
  // HORA desabilitada por enquanto
] as const;
const aba = ref<'BASE' | 'TNP' | 'LI' | 'HORA'>('BASE');

/**
 * Card ou lista. A lista mostra mais produtos por tela e é a leitura de quem
 * procura um item específico; o card é a leitura de quem está conferindo
 * cadastro. Nenhum dos dois serve para as duas coisas, então ficam os dois.
 *
 * A escolha vive no `localStorage` porque é conveniência de quem olha, não
 * dado do negócio: não precisa viajar até o servidor, e se o navegador recusar
 * (janela anônima, site data bloqueado) a tela só volta ao padrão.
 */
type Modo = 'card' | 'lista';
const CHAVE_MODO = 'pralis:produtos:modo';
const modo = ref<Modo>('card');

onMounted(() => {
  try {
    const salvo = localStorage.getItem(CHAVE_MODO);
    if (salvo === 'card' || salvo === 'lista') modo.value = salvo;
  } catch { /* sem localStorage a tela abre no padrão, e está tudo bem */ }
});

watch(modo, (novo) => {
  try { localStorage.setItem(CHAVE_MODO, novo); } catch { /* idem */ }
});

/** Inicial para o produto sem foto: mantém o alinhamento das linhas da lista. */
const inicial = (nome: string): string => nome.trim().charAt(0).toUpperCase() || '?';

// filtros (sem "Todos" — nada selecionado = sem filtro; pílulas alternam/limpam)
const statusFiltro = ref<'ativo' | 'inativo' | null>(null);
const statusOpcoes = [
  { value: 'ativo', label: 'Ativos' },
  { value: 'inativo', label: 'Inativos' },
] as const;
const tipoFiltro = ref<'revenda' | 'transformacao' | null>(null);
const tipoOpcoes = [
  { value: 'revenda', label: 'Revenda' },
  { value: 'transformacao', label: 'Transformação' },
] as const;
const setorFiltro = ref<string | null>(null);
const grupoFiltro = ref<string | null>(null);
const cadastradoPorFiltro = ref<string | null>(null);
const selecionados = ref<Set<string>>(new Set());
const dialogoExclusao = ref(false);
const fraseExclusao = ref('');
const excluindoLote = ref(false);
type ClasseAbc = 'A' | 'B' | 'C';
const curvaAbcFiltro = ref<ClasseAbc | null>(null);
const curvaAbcOpcoes = [
  { value: 'A', label: 'A · maior impacto' },
  { value: 'B', label: 'B · impacto intermediário' },
  { value: 'C', label: 'C · menor impacto' },
] as const;
const classesAbcPorProduto = ref(new Map<string, ClasseAbc>());
const carregandoAbc = ref(false);
const erroAbc = ref('');

function dataIso(data: Date) { return data.toISOString().slice(0, 10); }
async function carregarCurvaAbc() {
  if (!curvaAbcFiltro.value) {
    classesAbcPorProduto.value = new Map();
    erroAbc.value = '';
    return;
  }
  carregandoAbc.value = true;
  erroAbc.value = '';
  try {
    const fim = new Date();
    const inicio = new Date(fim);
    inicio.setUTCFullYear(inicio.getUTCFullYear() - 1);
    const resposta = await api.vendasCurvaAbc({
      loja: aba.value,
      inicio: dataIso(inicio),
      fim: dataIso(fim),
    });
    classesAbcPorProduto.value = new Map(
      resposta.itens
        .filter((item) => !!item.productId)
        .map((item) => [item.productId!, item.classe]),
    );
  } catch {
    erroAbc.value = 'Não foi possível calcular a Curva ABC agora.';
    classesAbcPorProduto.value = new Map();
  } finally {
    carregandoAbc.value = false;
  }
}

/**
 * Filtro vindo por URL — é assim que os atalhos do dashboard abrem a lista já
 * filtrada (/?loja=TNP&status=inativo). Roda no setup, antes do primeiro
 * `load()`, para a aba certa ser buscada de uma vez só.
 */
const rota = useRoute();
{
  const loja = String(rota.query.loja ?? '').toUpperCase();
  if (loja === 'BASE' || loja === 'TNP' || loja === 'LI' || loja === 'HORA') aba.value = loja;
  const status = String(rota.query.status ?? '');
  if (status === 'ativo' || status === 'inativo') statusFiltro.value = status;
  const tipo = String(rota.query.tipo ?? '');
  if (tipo === 'revenda' || tipo === 'transformacao') tipoFiltro.value = tipo;
}
const setores = computed(() => [...new Set(products.value.map((p) => p.setorEstoque).filter((s): s is string => !!s))]);
const grupos = computed(() => [...new Set(products.value.map((p) => p.grupo).filter((g): g is string => !!g))]);
const cadastradosPor = computed(() => [...new Set(products.value.map((p) => p.createdByName).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'pt-BR')));

// ordenação
const ordenar = ref<'recentes' | 'antigos' | 'az' | 'za' | 'codigo_asc' | 'codigo_desc'>('recentes');
const ordenarOpcoes = [
  { value: 'recentes', label: 'Mais recentes' },
  { value: 'antigos', label: 'Mais antigos' },
  { value: 'az', label: 'Nome (A–Z)' },
  { value: 'za', label: 'Nome (Z–A)' },
  { value: 'codigo_asc', label: 'Código (00001 →)' },
  { value: 'codigo_desc', label: 'Código (→ 00001)' },
] as const;

// painel de filtros (mostra/esconde) + contador de filtros ativos
const mostrarFiltros = ref(false);
const numFiltros = computed(
  () =>
    [statusFiltro.value, tipoFiltro.value, setorFiltro.value, grupoFiltro.value, cadastradoPorFiltro.value, curvaAbcFiltro.value].filter(Boolean).length +
    (ordenar.value !== 'recentes' ? 1 : 0),
);
const temFiltro = computed(() => numFiltros.value > 0 || !!search.value);
function limparFiltros() {
  statusFiltro.value = null;
  tipoFiltro.value = null;
  setorFiltro.value = null;
  grupoFiltro.value = null;
  cadastradoPorFiltro.value = null;
  curvaAbcFiltro.value = null;
  ordenar.value = 'recentes';
  search.value = '';
}

const page = ref(1);
const PER_PAGE = 10;

const filtrados = computed(() =>
  products.value.filter((p) => {
    if (statusFiltro.value && p.status !== statusFiltro.value) return false;
    if (tipoFiltro.value && p.tipo !== tipoFiltro.value) return false;
    if (setorFiltro.value && p.setorEstoque !== setorFiltro.value) return false;
    if (grupoFiltro.value && p.grupo !== grupoFiltro.value) return false;
    if (cadastradoPorFiltro.value && p.createdByName !== cadastradoPorFiltro.value) return false;
    if (curvaAbcFiltro.value && classesAbcPorProduto.value.get(p.id) !== curvaAbcFiltro.value) return false;
    return true;
  }),
);
const codigoNum = (p: Product) => Number(p.codigoInterno) || 0;
const ordenados = computed(() => {
  const arr = [...filtrados.value];
  switch (ordenar.value) {
    case 'antigos': return arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || codigoNum(a) - codigoNum(b));
    case 'az': return arr.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    case 'za': return arr.sort((a, b) => b.nome.localeCompare(a.nome, 'pt-BR'));
    case 'codigo_asc': return arr.sort((a, b) => codigoNum(a) - codigoNum(b));
    case 'codigo_desc': return arr.sort((a, b) => codigoNum(b) - codigoNum(a));
    default: return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || codigoNum(b) - codigoNum(a)); // recentes (último → primeiro)
  }
});
const totalPaginas = computed(() => Math.max(1, Math.ceil(ordenados.value.length / PER_PAGE)));
const paginados = computed(() => ordenados.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE));

// volta pra página 1 ao trocar filtro/ordem/busca/aba; mantém a página válida quando a lista muda
watch([statusFiltro, tipoFiltro, setorFiltro, grupoFiltro, cadastradoPorFiltro, curvaAbcFiltro, ordenar, search, aba], () => { page.value = 1; });
watch(totalPaginas, (n) => { if (page.value > n) page.value = n; });

/** Substitui a lista só se ela mudou; no polling, ignora resposta idêntica. */
function aplicar(lista: Product[], silent: boolean) {
  const nova = JSON.stringify(lista);
  if (silent && nova === assinatura) return;
  assinatura = nova;
  products.value = lista;
}

/*
 * A base tem milhares de produtos que passaram por algum cadastro em algum
 * momento. O que a loja opera e bem menos — e e o que interessa no dia a dia.
 * Comeca DESLIGADO: esconder produto por padrao faria alguem procurar o que
 * esta ali e nao achar.
 */
const somenteVendidos = ref(false);

async function load(silent = false) {
  if (!silent) loading.value = true;
  erro.value = '';
  try {
    const q = search.value || undefined;
    if (isAdmin.value) {
      aplicar(
        aba.value === 'BASE'
          ? await api.listBase(q)
          : await api.listProducts(q, aba.value, somenteVendidos.value),
        silent,
      );
    } else {
      aplicar(await api.listProducts(q, undefined, somenteVendidos.value), silent);
    }
  } catch {
    if (!silent) erro.value = 'Não foi possível carregar.';
  } finally {
    if (!silent) loading.value = false;
  }
}

watch(aba, () => load());
watch([aba, curvaAbcFiltro], () => void carregarCurvaAbc());

async function remover(p: Product) {
  if (!confirm(`Excluir "${p.nome}"?`)) return;
  try {
    await api.deleteProduct(p.id);
  } catch (e) {
    // A API BLOQUEIA a exclusão quando a linha da planilha não pôde ser
    // apagada — o produto continua na lista de propósito. Sem esta mensagem o
    // usuário clicaria em Excluir e nada aconteceria, sem explicação.
    flash.value = {
      tipo: 'error',
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível excluir o produto.',
    };
    return;
  }
  await load();
}

function marcarSelecionado(id: string, marcado: boolean | null) {
  const proximo = new Set(selecionados.value);
  if (marcado) proximo.add(id); else proximo.delete(id);
  selecionados.value = proximo;
}
function selecionarPagina() { selecionados.value = new Set([...selecionados.value, ...paginados.value.map((p) => p.id)]); }
function limparSelecao() { selecionados.value = new Set(); }
const fraseEsperadaExclusao = computed(() => `EXCLUIR ${selecionados.value.size} PRODUTOS`);
async function excluirSelecionados() {
  if (fraseExclusao.value.trim().toUpperCase() !== fraseEsperadaExclusao.value || !selecionados.value.size) return;
  excluindoLote.value = true;
  try {
    const resposta = await api.deleteProductsBatch([...selecionados.value], fraseExclusao.value);
    const { excluidos, falhas } = resposta.data;
    selecionados.value = new Set(falhas.map((f) => f.id));
    dialogoExclusao.value = false; fraseExclusao.value = '';
    flash.value = { tipo: falhas.length ? 'warning' : 'success', texto: `${excluidos.length} excluído(s).${falhas.length ? ` ${falhas.length} não puderam ser excluídos.` : ''}` };
    await load();
  } catch (e) { flash.value = { tipo: 'error', texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível excluir os produtos selecionados.' }; }
  finally { excluindoLote.value = false; }
}

function abrindoStatus(id: string): boolean {
  return statusEmAlteracao.value.has(id);
}

function marcarStatusEmAlteracao(id: string, alterando: boolean) {
  const ids = new Set(statusEmAlteracao.value);
  if (alterando) ids.add(id);
  else ids.delete(id);
  statusEmAlteracao.value = ids;
}

/** Ativa/inativa no próprio card, preservando a mesma regra de edição da API. */
async function alternarStatus(p: Product) {
  if (abrindoStatus(p.id)) return;
  const novoStatus = p.status === 'ativo' ? 'inativo' : 'ativo';
  marcarStatusEmAlteracao(p.id, true);
  try {
    const resposta = await api.updateProduct(p.id, { status: novoStatus });
    const listaAtualizada = products.value.map((item) => item.id === p.id ? resposta.data : item);
    assinatura = JSON.stringify(listaAtualizada);
    products.value = listaAtualizada;
    const espelhoPendente = ['failed', 'pending', 'misconfigured'].includes(resposta.details?.sheetSync ?? '');
    flash.value = {
      tipo: espelhoPendente ? 'warning' : 'success',
      texto: resposta.message || `Produto ${novoStatus === 'ativo' ? 'ativado' : 'inativado'}.`,
    };
  } catch (e: unknown) {
    flash.value = {
      tipo: 'error',
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível alterar o status do produto.',
    };
  } finally {
    marcarStatusEmAlteracao(p.id, false);
  }
}

function abrirFoto(p: Product) {
  if (p.fotoUrl) fotoAberta.value = { url: p.fotoUrl, nome: p.nome };
}

onMounted(() => {
  load();
  void carregarMargens();
  // Não atualiza com a aba em segundo plano: gasta requisição à toa e é a
  // volta ao primeiro plano que interessa.
  timer = setInterval(() => { if (!document.hidden) load(true); }, 5000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });

/*
 * Margem padrão de cada grupo, para o card calcular o MESMO preço que o
 * formulário. Antes o card passava `margemGrupo: 0` fixo: um produto que
 * herda a margem do grupo aparecia na lista pelo custo e, ao abrir, com outro
 * número. Duas telas, dois preços, para o mesmo produto.
 *
 * A chave é normalizada porque os nomes de grupo carregam U+2060 invisível —
 * só na comparação; o texto exibido continua o oficial.
 */
const margemPorGrupo = ref<Map<string, number | null>>(new Map());

async function carregarMargens() {
  try {
    const regras = await api.listGroupTaxRules();
    margemPorGrupo.value = new Map(
      regras.map((r) => [ProductRules.normalizarGrupo(r.grupo), r.margemPadrao]),
    );
  } catch {
    // sem as regras o card cai no comportamento anterior; não vale derrubar a lista
    margemPorGrupo.value = new Map();
  }
}

// BUG-01: quando o cálculo é automático, o card mostra o V. Venda CALCULADO
// (custo/qtCad + margem); senão, o valor pontual. Mesma regra do formulário.
function preco(p: Product): string | null {
  const doGrupo = margemPorGrupo.value.get(ProductRules.normalizarGrupo(p.grupo));
  const v = ProductRules.calcularVVenda({
    auto: p.auto,
    custo: p.custo ?? 0,
    qtCad: p.qtCad,
    margemPontual: p.margemPontual,
    margemGrupo: doGrupo ?? 0,
    vVendaPontual: p.vVendaPontual ?? 0,
    descricao: p.nome, // não-vazio garante o cálculo (descrição vazia retornaria 0)
  });
  return v ? v.toFixed(2).replace('.', ',') : null;
}
</script>

<template>
  <div class="cx-page catalog-page">
    <v-snackbar
      v-model="mostrarFlash"
      :color="flash?.tipo ?? 'success'"
      :timeout="flash?.tipo === 'success' ? 4000 : 9000"
      location="top"
    >
      {{ flash?.texto }}
      <template #actions>
        <v-btn variant="text" @click="mostrarFlash = false">Fechar</v-btn>
      </template>
    </v-snackbar>

    <v-dialog :model-value="!!fotoAberta" max-width="760" @update:model-value="(aberto) => { if (!aberto) fotoAberta = null; }">
      <v-card v-if="fotoAberta" rounded="lg">
        <v-card-title class="d-flex align-center ga-2">
          <span class="text-truncate">{{ fotoAberta.nome }}</span>
          <v-spacer />
          <v-btn icon="close" variant="text" aria-label="Fechar foto" @click="fotoAberta = null" />
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-2 pa-sm-4">
          <v-img :src="fotoAberta.url" :alt="`Foto ampliada de ${fotoAberta.nome}`" max-height="72vh" contain class="rounded-lg bg-grey-lighten-4" />
        </v-card-text>
      </v-card>
    </v-dialog>
    <v-dialog v-model="dialogoExclusao" max-width="520">
      <v-card rounded="lg">
        <v-card-title>Excluir {{ selecionados.size }} produto(s)?</v-card-title>
        <v-card-text>
          Esta ação remove os produtos selecionados do sistema e da planilha. Digite <strong>{{ fraseEsperadaExclusao }}</strong> para confirmar.
          <v-text-field v-model="fraseExclusao" class="mt-4" :placeholder="fraseEsperadaExclusao" label="Frase de confirmação" hide-details />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn @click="dialogoExclusao = false">Cancelar</v-btn><v-btn color="error" :loading="excluindoLote" :disabled="fraseExclusao.trim().toUpperCase() !== fraseEsperadaExclusao" @click="excluirSelecionados">Excluir selecionados</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <PwaInstallCard />

    <div class="cx-toolbar catalog-toolbar mb-4" role="search" aria-label="Buscar e filtrar produtos">
      <v-text-field
        v-model="search"
        density="compact"
        variant="outlined"
        hide-details
        aria-label="Buscar produto por nome, código interno ou código de barras"
        placeholder="Buscar nome ou código..."
        prepend-inner-icon="search"
        class="catalog-toolbar__search"
        @keyup.enter="load()"
      />
      <!--
        Fora do painel de filtros de propósito: não é um filtro a mais, é a
        pergunta que separa o catálogo que a loja opera do histórico inteiro.
      -->
      <v-chip
        :variant="somenteVendidos ? 'flat' : 'outlined'"
        :color="somenteVendidos ? 'primary' : 'grey-darken-1'"
        label
        :aria-pressed="somenteVendidos"
        class="catalog-toolbar__sold"
        @click="somenteVendidos = !somenteVendidos; load()"
      >
        <v-icon start size="18">{{ somenteVendidos ? 'check' : 'sell' }}</v-icon>
        Só os que já vendi
      </v-chip>
      <v-spacer class="d-none d-lg-flex" />
      <div class="catalog-toolbar__actions">
        <!-- botão que mostra/esconde o painel de filtros (estilo marketplace) -->
        <v-btn variant="outlined" color="grey-darken-2" rounded="lg" @click="mostrarFiltros = !mostrarFiltros">
          <v-icon start>tune</v-icon>
          Filtros
          <v-chip v-if="numFiltros" size="x-small" color="primary" class="ml-2 font-weight-bold">{{ numFiltros }}</v-chip>
          <v-icon end size="18">{{ mostrarFiltros ? 'expand_less' : 'expand_more' }}</v-icon>
        </v-btn>
        <v-btn-toggle v-model="modo" mandatory density="compact" variant="outlined" divided>
          <v-btn value="card" aria-label="Ver em cards"><v-icon>grid_view</v-icon></v-btn>
          <v-btn value="lista" aria-label="Ver em lista"><v-icon>view_list</v-icon></v-btn>
        </v-btn-toggle>
        <template v-if="isAdmin">
          <v-btn v-if="selecionados.size" color="error" variant="tonal" prepend-icon="delete" @click="dialogoExclusao = true">Excluir {{ selecionados.size }}</v-btn>
          <v-btn v-if="selecionados.size" size="small" variant="text" @click="limparSelecao">Limpar seleção</v-btn>
        </template>
        <v-btn v-if="!isAdmin" variant="tonal" color="primary" prepend-icon="download" to="/importar">Importar da base</v-btn>
        <!-- só o admin cadastra produto novo (sempre na base geral) -->
        <v-btn v-if="isAdmin" color="primary" prepend-icon="add" to="/produtos/novo">Novo</v-btn>
      </div>
    </div>

    <!-- painel de filtros (abre/fecha) -->
    <v-expand-transition>
      <v-card v-show="mostrarFiltros" flat border rounded="lg" class="catalog-filters pa-4 mb-4">
        <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-4">
          <div>
            <div class="cx-section-label">REFINAR RESULTADOS</div>
            <div class="text-body-2 cx-muted mt-1">Combine os filtros para encontrar o produto certo.</div>
          </div>
          <v-btn v-if="temFiltro" size="small" variant="text" color="primary" prepend-icon="filter_alt_off" @click="limparFiltros">Limpar filtros</v-btn>
        </div>
        <div class="d-flex flex-column flex-sm-row flex-sm-wrap align-stretch align-sm-center ga-3">
          <!-- Status -->
          <div class="d-flex align-center ga-2 flex-wrap">
            <span class="text-caption text-medium-emphasis" style="width: 44px">Status</span>
            <v-btn
              v-for="s in statusOpcoes"
              :key="s.value"
              size="small"
              rounded="lg"
              :variant="statusFiltro === s.value ? 'flat' : 'outlined'"
              :color="statusFiltro === s.value ? 'primary' : 'grey-darken-1'"
              @click="statusFiltro = statusFiltro === s.value ? null : s.value"
            >
              {{ s.label }}
            </v-btn>
          </div>
          <v-divider vertical class="mx-1 d-none d-sm-flex" style="height: 24px; align-self: center" />
          <!-- Tipo -->
          <div class="d-flex align-center ga-2 flex-wrap">
            <span class="text-caption text-medium-emphasis" style="width: 44px">Tipo</span>
            <v-btn
              v-for="t in tipoOpcoes"
              :key="t.value"
              size="small"
              rounded="lg"
              :variant="tipoFiltro === t.value ? 'flat' : 'outlined'"
              :color="tipoFiltro === t.value ? 'primary' : 'grey-darken-1'"
              @click="tipoFiltro = tipoFiltro === t.value ? null : t.value"
            >
              {{ t.label }}
            </v-btn>
          </div>
          <v-divider vertical class="mx-1 d-none d-sm-flex" style="height: 24px; align-self: center" />
          <!-- Curva ABC: mesma regra do módulo de Vendas, sobre os últimos 12 meses. -->
          <v-select
            v-model="curvaAbcFiltro"
            :items="curvaAbcOpcoes"
            item-title="label"
            item-value="value"
            label="Curva ABC (12 meses)"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            rounded="lg"
            prepend-inner-icon="donut_large"
            :loading="carregandoAbc"
            class="filtro-select filtro-item"
          />
          <v-select v-model="setorFiltro" :items="setores" label="Setor" density="compact" variant="outlined" hide-details clearable rounded="lg" prepend-inner-icon="warehouse" class="filtro-select filtro-item" />
          <v-select v-model="grupoFiltro" :items="grupos" label="Grupo" density="compact" variant="outlined" hide-details clearable rounded="lg" prepend-inner-icon="sell" class="filtro-select filtro-item" />
          <v-select v-if="isAdmin" v-model="cadastradoPorFiltro" :items="cadastradosPor" label="Cadastrado por" density="compact" variant="outlined" hide-details clearable rounded="lg" prepend-inner-icon="person" class="filtro-select filtro-item" />
          <v-select v-model="ordenar" :items="ordenarOpcoes" item-title="label" item-value="value" label="Ordenar" density="compact" variant="outlined" hide-details rounded="lg" prepend-inner-icon="swap_vert" class="filtro-select filtro-item" />
        </div>
      </v-card>
    </v-expand-transition>

    <!-- Admin: alterna entre o catálogo Geral (Base) e o de cada loja -->
    <v-tabs v-if="isAdmin" v-model="aba" color="primary" density="compact" class="catalog-tabs mb-4" aria-label="Catálogos por loja">
      <v-tab v-for="t in abas" :key="t.key" :value="t.key">{{ t.label }}</v-tab>
    </v-tabs>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
    <v-alert v-if="erroAbc" type="warning" variant="tonal" class="mb-4">{{ erroAbc }}</v-alert>
    <v-alert v-if="isAdmin && selecionados.size" type="info" variant="tonal" class="mb-4">
      {{ selecionados.size }} produto(s) selecionado(s). <v-btn size="small" variant="text" @click="selecionarPagina">Selecionar página atual</v-btn>
    </v-alert>
    <v-alert v-if="curvaAbcFiltro && !carregandoAbc && !erroAbc && !classesAbcPorProduto.size" type="info" variant="tonal" class="mb-4">
      Não há produtos vinculados à Curva {{ curvaAbcFiltro }} nos últimos 12 meses para esta aba.
    </v-alert>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <!--
      LISTA: foto, nome, preço, código interno e status — o que o José pediu.
      Uma linha por produto, para caber mais gente na tela que os cards.
    -->
    <v-card v-if="paginados.length && modo === 'lista'" flat border rounded="lg" class="catalog-list mb-2">
      <v-list lines="two" density="comfortable">
        <template v-for="(p, i) in paginados" :key="p.id">
          <v-divider v-if="i > 0" />
          <v-list-item :to="`/produtos/${p.id}`" class="py-2">
            <template #prepend>
              <v-checkbox v-if="isAdmin" :model-value="selecionados.has(p.id)" density="compact" hide-details class="mr-2" @click.stop @update:model-value="marcarSelecionado(p.id, $event)" />
              <v-avatar
                size="44"
                rounded="lg"
                :color="p.fotoUrl ? undefined : 'bege'"
                :class="{ 'foto-clicavel': p.fotoUrl }"
                :role="p.fotoUrl ? 'button' : undefined"
                :tabindex="p.fotoUrl ? 0 : undefined"
                :aria-label="p.fotoUrl ? `Abrir foto de ${p.nome}` : undefined"
                @click.prevent.stop="abrirFoto(p)"
                @keydown.enter.prevent.stop="abrirFoto(p)"
                @keydown.space.prevent.stop="abrirFoto(p)"
              >
                <v-img v-if="p.fotoUrl" :src="p.fotoUrl" cover />
                <span v-else class="text-subtitle-1 font-weight-bold text-primary">{{ inicial(p.nome) }}</span>
              </v-avatar>
            </template>

            <v-list-item-title class="font-weight-bold">{{ p.nome }}</v-list-item-title>
            <v-list-item-subtitle>
              {{ p.codigoInterno || 'sem código interno' }}
              <span v-if="preco(p)"> · <strong>R$ {{ preco(p) }}</strong></span>
            </v-list-item-subtitle>

            <template #append>
              <div class="d-flex align-center ga-2">
                <v-btn
                  :color="p.status === 'ativo' ? 'success' : 'grey-darken-1'"
                  variant="tonal"
                  size="small"
                  rounded="pill"
                  :loading="abrindoStatus(p.id)"
                  :aria-label="`${p.status === 'ativo' ? 'Inativar' : 'Ativar'} ${p.nome}`"
                  @click.prevent.stop="alternarStatus(p)"
                >
                  {{ p.status === 'ativo' ? 'Ativo' : 'Inativo' }}
                </v-btn>
                <!-- `.prevent` para o clique de excluir não navegar para a edição -->
                <v-btn
                  v-if="isAdmin"
                  icon="delete"
                  size="small"
                  variant="text"
                  color="error"
                  aria-label="Excluir produto"
                  @click.prevent.stop="remover(p)"
                />
              </div>
            </template>
          </v-list-item>
        </template>
      </v-list>
    </v-card>

    <v-row v-if="paginados.length && modo === 'card'">
      <v-col v-for="p in paginados" :key="p.id" cols="12" sm="6" md="4">
        <v-card border flat rounded="lg" class="h-100 product-card">
          <v-card-item>
            <div class="product-card__header">
              <v-checkbox v-if="isAdmin" :model-value="selecionados.has(p.id)" density="compact" hide-details @click.stop @update:model-value="marcarSelecionado(p.id, $event)" />
              <div class="product-card__identity">
                <v-avatar
                  size="46"
                  rounded="lg"
                  :color="p.fotoUrl ? undefined : 'bege'"
                  :class="{ 'foto-clicavel': p.fotoUrl }"
                  :role="p.fotoUrl ? 'button' : undefined"
                  :tabindex="p.fotoUrl ? 0 : undefined"
                  :aria-label="p.fotoUrl ? `Abrir foto de ${p.nome}` : undefined"
                  @click.stop="abrirFoto(p)"
                  @keydown.enter.prevent.stop="abrirFoto(p)"
                  @keydown.space.prevent.stop="abrirFoto(p)"
                >
                  <v-img v-if="p.fotoUrl" :src="p.fotoUrl" cover />
                  <v-icon v-else color="primary">inventory_2</v-icon>
                </v-avatar>
                <div class="product-card__name-wrap">
                  <div class="product-card__name" :title="p.nome">{{ p.nome }}</div>
                  <div class="product-card__code">{{ p.codigoInterno || '—' }}</div>
                </div>
              </div>
              <v-btn
                :color="p.status === 'ativo' ? 'success' : 'grey-darken-1'"
                variant="tonal"
                size="small"
                rounded="pill"
                class="product-card__status font-weight-medium flex-shrink-0"
                :loading="abrindoStatus(p.id)"
                :aria-label="`${p.status === 'ativo' ? 'Inativar' : 'Ativar'} ${p.nome}`"
                @click.stop="alternarStatus(p)"
              >
                {{ p.status === 'ativo' ? 'Ativo' : 'Inativo' }}
              </v-btn>
            </div>
          </v-card-item>
          <v-divider />
          <v-card-text class="product-card__details">
            <div class="product-card__detail">
              <span class="product-card__label">Tipo</span>
              <v-chip size="x-small" variant="tonal" class="font-weight-medium" :color="p.tipo === 'revenda' ? 'primary' : 'secondary'">
                {{ p.tipo === 'revenda' ? 'Revenda' : 'Transformação' }}
              </v-chip>
            </div>
            <div class="product-card__detail">
              <span class="product-card__label">Gramatura</span>
              <span>{{ p.quantidade }} {{ p.medidaBase }}</span>
            </div>
            <div class="product-card__detail">
              <span class="product-card__label">Marca</span>
              <span class="product-card__value">{{ p.marca || '—' }}</span>
            </div>
            <div v-if="preco(p)" class="product-card__detail">
              <span class="product-card__label">Venda</span>
              <span class="font-weight-bold tabular">R$ {{ preco(p) }}</span>
            </div>
            <div v-if="p.createdByName" class="text-caption text-medium-emphasis mt-2">
              <v-icon size="13">person</v-icon> cadastrado por {{ p.createdByName }}
            </div>
          </v-card-text>
          <v-divider />
          <v-card-actions class="product-card__actions">
            <!-- editar: admin e colaborador; excluir: só admin -->
            <v-btn size="small" variant="text" :to="`/produtos/${p.id}`" prepend-icon="edit">Editar</v-btn>
            <v-spacer />
            <v-btn v-if="isAdmin" size="small" variant="text" color="error" prepend-icon="delete" @click="remover(p)">Excluir</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <!--
      Condição PRÓPRIA, e não `v-else` da lista de cards.
      Encadeado, ele aparecia junto com a visualização em lista: o `v-if` dos
      cards fica falso quando o modo é lista, o `v-else` assumia, e a tela
      mostrava "Nenhum produto cadastrado ainda" logo abaixo de 332 produtos.
      Quem decide se este bloco aparece é a AUSÊNCIA de produtos, não o modo
      de visualização que está ligado.
    -->
    <v-card
      v-if="!paginados.length && !loading && !erro"
      flat
      border
      rounded="lg"
      class="cx-empty text-medium-emphasis"
    >
      <span class="cx-empty__icon"><v-icon size="32">inventory_2</v-icon></span>
      <!-- "cadastrado" é o verbo do admin; a loja não cadastra, ela importa -->
      <div class="cx-empty__title">
        {{ temFiltro
          ? 'Nenhum produto com esses filtros.'
          : (isAdmin ? 'Nenhum produto cadastrado ainda.' : 'Nenhum produto importado ainda.') }}
      </div>
      <!--
        Os números do dashboard somam TODAS as lojas, mas esta lista mostra uma
        aba por vez. Sem esta linha, clicar em "Inativos" e cair numa lista
        vazia parece defeito — e não é: o produto está em outra aba.
      -->
      <div v-if="temFiltro && isAdmin" class="cx-empty__description">
        Você está vendo a aba <strong>{{ abas.find((a) => a.key === aba)?.label ?? aba }}</strong>.
        Produtos com esses filtros podem estar em outra loja.
      </div>
      <v-btn v-if="temFiltro" color="primary" variant="tonal" class="mt-4" @click="limparFiltros">Limpar filtros</v-btn>
      <!--
        Só o admin cadastra produto novo; a loja recebe por importação. Oferecer
        "Cadastrar o primeiro" para quem não é admin mandava a pessoa para uma
        tela que o servidor recusa com 403 — e no primeiro acesso da loja, que é
        exatamente quando a lista está vazia, esse era o único botão à vista.
      -->
      <v-btn v-else-if="isAdmin" color="primary" variant="tonal" class="mt-4" to="/produtos/novo">Cadastrar o primeiro</v-btn>
      <v-btn v-else color="primary" variant="tonal" class="mt-4" prepend-icon="download" to="/importar">Importar da base</v-btn>
    </v-card>

    <!-- paginação (10 por página) -->
    <div v-if="filtrados.length" class="catalog-pagination d-flex align-center justify-space-between mt-4 flex-wrap ga-2">
      <div class="text-caption text-medium-emphasis">
        {{ filtrados.length }} produto(s) · página {{ page }} de {{ totalPaginas }}
      </div>
      <v-pagination
        v-if="totalPaginas > 1"
        v-model="page"
        :length="totalPaginas"
        :total-visible="paginasVisiveis"
        density="comfortable"
        rounded="lg"
        active-color="primary"
      />
    </div>
  </div>
</template>

<style scoped>
.catalog-toolbar__search {
  flex: 1 1 310px;
  min-width: 220px;
  max-width: 560px;
}
.catalog-toolbar__sold {
  min-height: 40px;
}
.catalog-toolbar__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--cx-space-2);
  margin-left: auto;
}
.catalog-filters {
  background: var(--cx-surface-sunken);
}
.catalog-tabs {
  border-bottom: 1px solid var(--cx-line);
}
.catalog-list {
  overflow: hidden;
}
.catalog-pagination {
  min-height: 52px;
}
/* selects do filtro: largura total no mobile, limitada no desktop */
.filtro-item {
  width: 100%;
}
@media (min-width: 600px) {
  .filtro-item {
    width: auto;
    min-width: 175px;
    max-width: 230px;
  }
}
/* Mantém a altura nativa do Vuetify: campos de 32px cortavam os rótulos. */
.filtro-select :deep(.v-field) {
  font-size: var(--cx-text-sm);
}
.product-card {
  overflow: hidden;
  transition: border-color 160ms var(--cx-ease);
}
.product-card:hover {
  border-color: color-mix(in srgb, var(--cx-brand) 30%, var(--cx-line)) !important;
}
.product-card__header,
.product-card__identity {
  display: flex;
  align-items: center;
  gap: var(--cx-space-3);
  min-width: 0;
}
.product-card__header {
  gap: var(--cx-space-2);
  flex-wrap: wrap;
}
.product-card__identity {
  flex: 1 1 calc(100% - 48px);
}
.product-card__name-wrap {
  min-width: 0;
}
.product-card__name {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--cx-ink);
  font-size: var(--cx-text-md);
  font-weight: 700;
  letter-spacing: -0.018em;
  line-height: 1.3;
}
.product-card__code {
  margin-top: var(--cx-space-1);
  color: var(--cx-ink-soft);
  font-size: var(--cx-text-xs);
  font-variant-numeric: tabular-nums;
}
.product-card__status {
  margin-left: auto;
}
.product-card__details {
  display: grid;
  gap: var(--cx-space-2);
  padding-block: var(--cx-space-4);
}
.product-card__detail {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--cx-space-3);
  font-size: var(--cx-text-sm);
}
.product-card__label {
  flex-shrink: 0;
  color: var(--cx-ink-soft);
}
.product-card__value {
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: right;
}
.product-card__actions {
  min-height: 52px;
  padding-inline: var(--cx-space-3);
}
.foto-clicavel {
  cursor: zoom-in;
  outline-offset: 3px;
}
.foto-clicavel:focus-visible {
  outline: 2px solid var(--cx-brand);
}
@media (max-width: 600px) {
  .catalog-toolbar__search {
    flex-basis: 100%;
    max-width: none;
  }
  .catalog-toolbar__actions {
    width: 100%;
    margin-left: 0;
  }
  .catalog-toolbar__actions :deep(.v-btn-toggle) {
    margin-left: auto;
  }
  .catalog-list :deep(.v-list-item) {
    grid-template-areas:
      "prepend content"
      "append append";
    grid-template-columns: max-content minmax(0, 1fr);
    row-gap: var(--cx-space-2);
    padding-block: var(--cx-space-3) !important;
  }
  .catalog-list :deep(.v-list-item__append) {
    justify-self: end;
  }
  .catalog-list :deep(.v-list-item-title) {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    white-space: normal;
  }
  .catalog-pagination {
    justify-content: center !important;
  }
}
</style>
