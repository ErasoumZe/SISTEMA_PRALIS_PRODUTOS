<script setup lang="ts">
import type {
  FiltrosUnificacao, GrupoUnificacao, PaginaGrupos, StagingUnificacao, TotaisUnificacao,
} from '~/composables/useApi';

const api = useApi();
const { podeVer } = useAuth();
const flash = useFlash();

const FONTES: Record<string, string> = {
  vendas_pdv_12m: 'Vendas dos PDVs (12 meses)',
  pralis: 'Cadastro Pralis',
  planilha_nova: 'Planilha nova',
  sia_li: 'SIA Lisboa',
  compilart_tnp: 'Compilart TNP',
  planilha_tnp: 'Planilha antiga TNP',
  fiscal_tnp: 'Fiscal TNP',
  vendidos_tnp: 'Histórico vendido TNP',
};

/**
 * As quatro decisões possíveis, em português e separadas pelo que fazem: as
 * duas primeiras PÕEM produto no catálogo, as duas últimas só tiram o grupo da
 * fila. Mostrar o valor cru (`nao_e_o_mesmo`) fazia o cartão parecer concluído
 * sem dizer se algo foi criado.
 */
const DECISAO: Record<string, string> = {
  unificado: 'Unificado — virou cadastro',
  criado: 'Criado no cadastro',
  nao_e_o_mesmo: 'Descartado — não é o mesmo produto',
  ignorado: 'Descartado — ignorado',
};
const CRIAM_CADASTRO = ['unificado', 'criado'];

type Escopo = 'todos' | 'vendidos';
type Visao = 'todos' | 'pendentes' | 'exatos' | 'revisar' | 'unificados' | 'descartados';
const escopo = ref<Escopo>('todos');
const visao = ref<Visao>('todos');
const busca = ref('');
const loja = ref<string>();
const pagina = ref(1);
const dados = ref<PaginaGrupos | null>(null);
const totais = ref<TotaisUnificacao | null>(null);
const staging = ref<StagingUnificacao | null>(null);

/**
 * Quantas vendas dos últimos 12 meses entraram na última carga.
 *
 * `null` = ainda não sei. `0` = o universo da tela está vazio, e aí a lista
 * vazia não é "nada a fazer": é o robô de vendas que parou de alimentar o
 * banco. Sem este aviso, os dois casos são a mesma tela em branco.
 */
const vendasCarregadas = computed<number | null>(() => {
  const fontes = staging.value?.fontes;
  if (!fontes) return null;
  return fontes.find((f) => f.fonte === 'vendas_pdv_12m')?.linhas ?? 0;
});
const carregando = ref(false);
const atualizandoFontes = ref(false);
const agindo = ref('');
const nomesEscolhidos = reactive<Record<string, string>>({});

function filtros(): FiltrosUnificacao {
  const base: FiltrosUnificacao = {
    pagina: pagina.value,
    tamanho: 30,
    somenteVendidos: escopo.value === 'vendidos' ? true : undefined,
    loja: loja.value,
    q: busca.value.trim() || undefined,
    decisao: visao.value === 'unificados' ? 'unificados'
      : visao.value === 'descartados' ? 'descartados'
        : visao.value === 'pendentes' || visao.value === 'exatos' || visao.value === 'revisar'
          ? 'pendente'
          : undefined,
  };
  // "exatos" no servidor cobre os DOIS códigos: barras e interno. Mandar
  // `mesmo_cod_barras` aqui esconderia quem casa só pelo código interno.
  if (visao.value === 'exatos') base.filtro = 'exatos';
  if (visao.value === 'revisar') base.revisar = true;
  return base;
}

async function carregar() {
  carregando.value = true;
  try {
    const [lista, health] = await Promise.all([
      api.unificacaoGrupos(filtros()),
      api.unificacaoHealth({ somenteVendidos: escopo.value === 'vendidos' ? true : undefined }),
    ]);
    dados.value = lista;
    totais.value = health.totais;
    staging.value = health.staging;
    for (const grupo of lista.grupos) {
      if (!nomesEscolhidos[grupo.id]) nomesEscolhidos[grupo.id] = grupo.candidato.nome;
    }
  } catch (error: unknown) {
    flash.value = {
      texto: (error as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar a Central.',
      tipo: 'error',
    };
  } finally {
    carregando.value = false;
  }
}

async function atualizarFontes() {
  atualizandoFontes.value = true;
  try {
    await api.unificacaoCarregar();
    pagina.value = 1;
    await carregar();
    flash.value = { texto: 'Fontes e vendas dos últimos 12 meses atualizadas.', tipo: 'success' };
  } catch (error: unknown) {
    flash.value = {
      texto: (error as { data?: { message?: string } })?.data?.message || 'Falha ao atualizar as fontes.',
      tipo: 'error',
    };
  } finally {
    atualizandoFontes.value = false;
  }
}

function nomesDoGrupo(grupo: GrupoUnificacao): string[] {
  return [...new Set(grupo.itens.map((item) => item.nome?.trim()).filter((nome): nome is string => !!nome))];
}

function itemVendido(grupo: GrupoUnificacao) {
  return grupo.itens.find((item) => item.fonte === 'vendas_pdv_12m');
}

function codigoPrincipal(grupo: GrupoUnificacao): string {
  return grupo.itens.find((item) => item.codBarras)?.codBarras || grupo.chave;
}

function criouCadastro(grupo: GrupoUnificacao): boolean {
  return !!grupo.decisao && CRIAM_CADASTRO.includes(grupo.decisao);
}

function classificacao(grupo: GrupoUnificacao) {
  if (grupo.decisao) {
    return criouCadastro(grupo)
      ? { texto: 'Virou cadastro', cor: 'success', icone: 'check_circle' }
      : { texto: 'Descartado', cor: 'grey', icone: 'do_not_disturb_on' };
  }
  if (grupo.flagBarrasConflitante) return { texto: 'Conflito de código', cor: 'error', icone: 'error' };
  if (grupo.flagNomesDivergentes || grupo.motivo === 'nome_parecido') {
    return { texto: 'Revisar nomes', cor: 'warning', icone: 'rule' };
  }
  if (grupo.motivo === 'mesmo_id_sistema' || grupo.motivo === 'mesmo_cod_barras' || grupo.motivo === 'mesmo_cod_interno') {
    return { texto: 'Correspondência exata', cor: 'success', icone: 'link' };
  }
  return { texto: 'Sem correspondência', cor: 'grey', icone: 'help' };
}

async function unificar(grupo: GrupoUnificacao) {
  const nome = nomesEscolhidos[grupo.id]?.trim();
  if (!nome) return;
  agindo.value = grupo.id;
  try {
    await api.unificacaoUnificar(grupo.id, { nome });
    flash.value = { texto: `Produto unificado usando o nome "${nome}".`, tipo: 'success' };
    await carregar();
  } catch (error: unknown) {
    flash.value = {
      texto: (error as { data?: { message?: string } })?.data?.message || 'Não foi possível unificar.',
      tipo: 'error',
    };
  } finally {
    agindo.value = '';
  }
}

async function marcar(grupo: GrupoUnificacao, acao: 'nao_e_o_mesmo' | 'ignorado') {
  agindo.value = grupo.id;
  try {
    await api.unificacaoMarcar(grupo.id, acao);
    await carregar();
  } catch (error: unknown) {
    flash.value = {
      texto: (error as { data?: { message?: string } })?.data?.message || 'Não foi possível registrar a decisão.',
      tipo: 'error',
    };
  } finally {
    agindo.value = '';
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch(busca, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { pagina.value = 1; void carregar(); }, 350);
});
watch([escopo, visao, loja], () => { pagina.value = 1; void carregar(); });
watch(pagina, () => void carregar());
onMounted(() => void carregar());
</script>

<template>
  <div class="central cx-page mx-auto">
    <div class="central__intro">
      <div>
        <div class="cx-section-label">CATÁLOGO · CONCILIAÇÃO</div>
        <h1>Central de Produtos</h1>
        <p>
          Todas as fontes históricas, a Base do sistema e a planilha oficial em uma única lista.
        </p>
      </div>
      <div class="central__top-actions">
        <v-btn v-if="podeVer('historico')" variant="tonal" prepend-icon="history" to="/produtos/historico-nomes">
          Histórico de nomes
        </v-btn>
        <v-btn color="primary" variant="tonal" prepend-icon="sync" :loading="atualizandoFontes" @click="atualizarFontes">
          Atualizar fontes
        </v-btn>
      </div>
    </div>

    <v-alert v-if="escopo === 'vendidos' && vendasCarregadas === 0" type="warning" variant="tonal" class="mb-4" icon="report">
      <div class="font-weight-bold">Nenhuma venda dos últimos 12 meses no banco.</div>
      <div class="text-body-2">
        O universo desta tela são os produtos que passaram pelos PDVs. Sem venda registrada,
        a lista fica vazia mesmo havendo cadastro. Confira se o robô de vendas está enviando
        dados antes de concluir que não há nada a unificar.
      </div>
    </v-alert>

    <v-row v-if="totais" dense class="mb-4">
      <v-col cols="6" md="3"><v-card flat border rounded="lg" class="central__metric">
        <div class="central__metric-label">{{ escopo === 'vendidos' ? 'Vendidos únicos (12 meses)' : 'Produtos únicos de todas as fontes' }}</div>
        <div class="central__metric-value">{{ totais.grupos.toLocaleString('pt-BR') }}</div>
      </v-card></v-col>
      <v-col cols="6" md="3"><v-card flat border rounded="lg" class="central__metric">
        <div class="central__metric-label">Já na Base</div>
        <div class="central__metric-value central__metric-value--positive">{{ totais.jaNoPralis.toLocaleString('pt-BR') }}</div>
      </v-card></v-col>
      <v-col cols="6" md="3"><v-card flat border rounded="lg" class="central__metric">
        <div class="central__metric-label">Vinculados à Base</div>
        <div class="central__metric-value central__metric-value--positive">{{ totais.unificados.toLocaleString('pt-BR') }}</div>
      </v-card></v-col>
      <v-col cols="6" md="3"><v-card flat border rounded="lg" class="central__metric">
        <div class="central__metric-label">Descartados</div>
        <div class="central__metric-value central__metric-value--muted">
          {{ totais.descartados.toLocaleString('pt-BR') }}
        </div>
      </v-card></v-col>
    </v-row>

    <v-card v-if="staging" flat border rounded="lg" class="central__sources mb-4">
      <div class="cx-section-label mb-2">FONTES DA ÚLTIMA ATUALIZAÇÃO</div>
      <div class="d-flex flex-wrap ga-2">
        <v-chip v-for="fonte in staging.fontes" :key="fonte.fonte" size="small" variant="tonal">
          {{ FONTES[fonte.fonte] || fonte.fonte }} · {{ fonte.linhas.toLocaleString('pt-BR') }}
        </v-chip>
      </div>
    </v-card>

    <v-card flat border rounded="lg" class="central__toolbar mb-4">
      <div class="central__toolbar-label">Universo de produtos</div>
      <v-btn-toggle v-model="escopo" mandatory color="primary" variant="outlined" density="comfortable" class="central__scope mb-4 flex-wrap">
        <v-btn value="todos">Todos os cadastros</v-btn>
        <v-btn value="vendidos">Já vendidos · 12 meses</v-btn>
      </v-btn-toggle>
      <div class="central__fields">
        <v-text-field v-model="busca" prepend-inner-icon="search" label="Buscar produto ou código" hide-details clearable density="compact" class="busca" />
        <v-select v-model="loja" :items="[{ title: 'TNP', value: 'TNP' }, { title: 'Lisboa', value: 'LI' }]" label="Loja" hide-details clearable density="compact" class="loja" />
      </div>
      <div class="central__views" aria-label="Situação da conciliação">
        <v-btn size="small" :aria-pressed="visao === 'todos'" :variant="visao === 'todos' ? 'flat' : 'tonal'" color="primary" @click="visao = 'todos'">Todos</v-btn>
        <v-btn size="small" :aria-pressed="visao === 'pendentes'" :variant="visao === 'pendentes' ? 'flat' : 'tonal'" color="primary" @click="visao = 'pendentes'">Pendentes</v-btn>
        <v-btn size="small" :aria-pressed="visao === 'exatos'" :variant="visao === 'exatos' ? 'flat' : 'tonal'" color="success" @click="visao = 'exatos'">Correspondência exata</v-btn>
        <v-btn size="small" :aria-pressed="visao === 'revisar'" :variant="visao === 'revisar' ? 'flat' : 'tonal'" color="warning" @click="visao = 'revisar'">Precisa analisar</v-btn>
        <v-btn size="small" :aria-pressed="visao === 'unificados'" :variant="visao === 'unificados' ? 'flat' : 'tonal'" color="success" @click="visao = 'unificados'">Viraram cadastro</v-btn>
        <v-btn size="small" :aria-pressed="visao === 'descartados'" :variant="visao === 'descartados' ? 'flat' : 'tonal'" @click="visao = 'descartados'">Descartados</v-btn>
      </div>
    </v-card>

    <v-progress-linear v-if="carregando" indeterminate color="primary" class="mb-3" />
    <v-alert v-if="!carregando && dados?.grupos.length === 0" type="info" variant="tonal">Nenhum produto encontrado com estes filtros.</v-alert>

    <v-card v-for="grupo in dados?.grupos || []" :key="grupo.id" flat border rounded="lg" class="central__item mb-3">
      <div class="d-flex flex-wrap align-start justify-space-between ga-3">
        <div>
          <div class="central__item-title">{{ grupo.candidato.nome || '(sem nome)' }}</div>
          <div class="central__item-meta">
            Código {{ codigoPrincipal(grupo) }}
            <span v-if="itemVendido(grupo)?.raw?.ultimaVenda"> · Última venda {{ itemVendido(grupo)?.raw?.ultimaVenda }}</span>
          </div>
        </div>
        <v-chip :color="classificacao(grupo).cor" :prepend-icon="classificacao(grupo).icone" variant="tonal" size="small">
          {{ classificacao(grupo).texto }}
        </v-chip>
      </div>

      <div class="d-flex flex-wrap ga-2 my-3">
        <v-chip v-for="fonte in grupo.fontes" :key="fonte" size="x-small" variant="tonal">{{ FONTES[fonte] || fonte }}</v-chip>
        <v-chip v-if="grupo.fontes.includes('planilha_nova')" size="x-small" color="info" variant="flat">na planilha nova</v-chip>
        <v-chip v-if="grupo.flagJaNoPralis" size="x-small" color="success" variant="flat">já cadastrado</v-chip>
      </div>

      <v-select v-if="!grupo.decisao" v-model="nomesEscolhidos[grupo.id]" :items="nomesDoGrupo(grupo)" label="Nome que será mantido" density="compact" hide-details class="nome mb-3" />
      <div v-if="nomesDoGrupo(grupo).length > 1" class="text-caption text-medium-emphasis mb-3">
        Nomes encontrados: {{ nomesDoGrupo(grupo).join(' · ') }}
      </div>

      <div v-if="!grupo.decisao" class="central__item-actions">
        <v-btn color="primary" :loading="agindo === grupo.id" :disabled="!nomesEscolhidos[grupo.id]" @click="unificar(grupo)">
          {{ grupo.flagJaNoPralis ? 'Vincular e atualizar na Base' : 'Adicionar à Base Geral' }}
        </v-btn>
        <v-btn variant="text" :disabled="!!agindo" @click="marcar(grupo, 'nao_e_o_mesmo')">Não é o mesmo produto</v-btn>
        <v-btn variant="text" :disabled="!!agindo" @click="marcar(grupo, 'ignorado')">Ignorar</v-btn>
      </div>
      <div v-else class="text-body-2" :class="criouCadastro(grupo) ? 'text-success' : 'text-medium-emphasis'">
        {{ DECISAO[grupo.decisao!] || grupo.decisao }}<span v-if="grupo.decididoPor"> · por {{ grupo.decididoPor }}</span>
      </div>
    </v-card>

    <div v-if="dados && dados.paginas > 1" class="d-flex justify-center mt-5">
      <v-pagination v-model="pagina" :length="dados.paginas" :total-visible="7" />
    </div>
  </div>
</template>

<style scoped>
.central { max-width: 1180px; min-width: 0; }
.central__intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--cx-space-4);
  margin-bottom: var(--cx-space-6);
}
.central__intro h1 {
  margin: var(--cx-space-1) 0;
  color: var(--cx-ink);
  font-size: var(--cx-text-title);
  font-weight: 750;
  letter-spacing: -.025em;
}
.central__intro p { max-width: 72ch; margin: 0; color: var(--cx-ink-soft); font-size: var(--cx-text-sm); line-height: 1.5; }
.central__top-actions { display: flex; flex-wrap: wrap; gap: var(--cx-space-2); }
.central__metric { height: 100%; min-height: 106px; padding: var(--cx-space-4); }
.central__metric-label { min-height: 2.7em; color: var(--cx-ink-soft); font-size: var(--cx-text-xs); line-height: 1.35; }
.central__metric-value { margin-top: var(--cx-space-2); color: var(--cx-ink); font-size: 1.6rem; font-weight: 750; letter-spacing: -.025em; line-height: 1.2; font-variant-numeric: tabular-nums; }
.central__metric-value--positive { color: var(--cx-positive); }
.central__metric-value--muted { color: var(--cx-ink-soft); }
.central__sources, .central__toolbar, .central__item { padding: var(--cx-space-5); }
.central__sources { background: var(--cx-surface-sunken); }
.central__toolbar-label { margin-bottom: var(--cx-space-3); color: var(--cx-ink); font-size: var(--cx-text-sm); font-weight: 700; }
.central__fields { display: flex; align-items: center; flex-wrap: wrap; gap: var(--cx-space-3); }
.central__views { display: flex; align-items: center; flex-wrap: wrap; gap: var(--cx-space-2); margin-top: var(--cx-space-4); padding-top: var(--cx-space-4); border-top: 1px solid var(--cx-line-soft); }
.central__views :deep(.v-btn) { min-height: 36px; text-transform: none; }
.central__item-title { color: var(--cx-ink); font-size: var(--cx-text-lg); font-weight: 700; line-height: 1.35; }
.central__item-meta { margin-top: var(--cx-space-1); color: var(--cx-ink-soft); font-size: var(--cx-text-sm); }
.central__item-actions { display: flex; flex-wrap: wrap; gap: var(--cx-space-2); padding-top: var(--cx-space-3); border-top: 1px solid var(--cx-line-soft); }
.busca { min-width: 0; flex: 1 1 350px; }
.loja { max-width: 220px; min-width: 180px; flex: 1 1 180px; }
.nome { max-width: 680px; }
@media (max-width: 600px) {
  .central__top-actions { width: 100%; }
  .central__top-actions :deep(.v-btn) { flex: 1 1 auto; min-height: 44px; }
  .central__metric { min-height: 116px; padding: var(--cx-space-3); }
  .central__sources, .central__toolbar, .central__item { padding: var(--cx-space-4); }
  .central__scope { width: 100%; height: auto; }
  .central__scope :deep(.v-btn) { flex: 1 1 0; min-width: 0; height: auto; min-height: 44px; padding: var(--cx-space-2); }
  .central__scope :deep(.v-btn__content) { white-space: normal; text-align: center; line-height: 1.2; }
  .loja { max-width: none; }
  .central__views :deep(.v-btn) { min-height: 44px; }
  .central__item-actions :deep(.v-btn) { flex: 1 1 auto; min-height: 44px; white-space: normal; }
}
</style>
