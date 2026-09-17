<script setup lang="ts">
import type {
  FiltrosUnificacao, GrupoUnificacao, PaginaGrupos, StagingUnificacao, TotaisUnificacao,
} from '~/composables/useApi';

const api = useApi();
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
  <div class="central mx-auto">
    <div class="d-flex flex-wrap align-center justify-space-between ga-3 mb-5">
      <div>
        <h1 class="text-h4 font-weight-bold">Central de Produtos</h1>
        <p class="text-body-2 text-medium-emphasis mt-1 mb-0">
          Todas as fontes históricas, a Base do sistema e a planilha oficial em uma única lista.
        </p>
      </div>
      <v-btn color="primary" variant="tonal" prepend-icon="sync" :loading="atualizandoFontes" @click="atualizarFontes">
        Atualizar fontes
      </v-btn>
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
      <v-col cols="6" md="3"><v-card flat border rounded="lg" class="pa-4">
        <div class="text-caption text-medium-emphasis">{{ escopo === 'vendidos' ? 'Vendidos únicos (12 meses)' : 'Produtos únicos de todas as fontes' }}</div>
        <div class="text-h5 font-weight-bold">{{ totais.grupos.toLocaleString('pt-BR') }}</div>
      </v-card></v-col>
      <v-col cols="6" md="3"><v-card flat border rounded="lg" class="pa-4">
        <div class="text-caption text-medium-emphasis">Já na Base</div>
        <div class="text-h5 font-weight-bold text-success">{{ totais.jaNoPralis.toLocaleString('pt-BR') }}</div>
      </v-card></v-col>
      <v-col cols="6" md="3"><v-card flat border rounded="lg" class="pa-4">
        <div class="text-caption text-medium-emphasis">Vinculados à Base</div>
        <div class="text-h5 font-weight-bold text-success">{{ totais.unificados.toLocaleString('pt-BR') }}</div>
      </v-card></v-col>
      <v-col cols="6" md="3"><v-card flat border rounded="lg" class="pa-4">
        <div class="text-caption text-medium-emphasis">Descartados</div>
        <div class="text-h5 font-weight-bold text-medium-emphasis">
          {{ totais.descartados.toLocaleString('pt-BR') }}
        </div>
      </v-card></v-col>
    </v-row>

    <v-card v-if="staging" flat border rounded="lg" class="pa-3 mb-4">
      <div class="text-caption text-medium-emphasis mb-2">Fontes incluídas na última atualização</div>
      <div class="d-flex flex-wrap ga-2">
        <v-chip v-for="fonte in staging.fontes" :key="fonte.fonte" size="small" variant="tonal">
          {{ FONTES[fonte.fonte] || fonte.fonte }} · {{ fonte.linhas.toLocaleString('pt-BR') }}
        </v-chip>
      </div>
    </v-card>

    <v-card flat border rounded="lg" class="pa-3 mb-4">
      <v-btn-toggle v-model="escopo" mandatory color="primary" variant="outlined" density="comfortable" class="mb-3 flex-wrap">
        <v-btn value="todos">Todos os cadastros</v-btn>
        <v-btn value="vendidos">Já vendidos · 12 meses</v-btn>
      </v-btn-toggle>
      <div class="d-flex flex-wrap ga-3 align-center">
        <v-text-field v-model="busca" prepend-inner-icon="search" label="Buscar produto ou código" hide-details clearable density="compact" class="busca" />
        <v-select v-model="loja" :items="[{ title: 'TNP', value: 'TNP' }, { title: 'Lisboa', value: 'LI' }]" label="Loja" hide-details clearable density="compact" class="loja" />
      </div>
      <div class="d-flex flex-wrap ga-2 mt-3">
        <v-chip :variant="visao === 'todos' ? 'flat' : 'tonal'" color="primary" @click="visao = 'todos'">Todos</v-chip>
        <v-chip :variant="visao === 'pendentes' ? 'flat' : 'tonal'" color="primary" @click="visao = 'pendentes'">Pendentes</v-chip>
        <v-chip :variant="visao === 'exatos' ? 'flat' : 'tonal'" color="success" @click="visao = 'exatos'">Correspondência exata</v-chip>
        <v-chip :variant="visao === 'revisar' ? 'flat' : 'tonal'" color="warning" @click="visao = 'revisar'">Precisa analisar</v-chip>
        <v-chip :variant="visao === 'unificados' ? 'flat' : 'tonal'" color="success" @click="visao = 'unificados'">Viraram cadastro</v-chip>
        <v-chip :variant="visao === 'descartados' ? 'flat' : 'tonal'" @click="visao = 'descartados'">Descartados</v-chip>
      </div>
    </v-card>

    <v-progress-linear v-if="carregando" indeterminate color="primary" class="mb-3" />
    <v-alert v-if="!carregando && dados?.grupos.length === 0" type="info" variant="tonal">Nenhum produto encontrado com estes filtros.</v-alert>

    <v-card v-for="grupo in dados?.grupos || []" :key="grupo.id" flat border rounded="lg" class="pa-4 mb-3">
      <div class="d-flex flex-wrap align-start justify-space-between ga-3">
        <div>
          <div class="text-h6 font-weight-bold">{{ grupo.candidato.nome || '(sem nome)' }}</div>
          <div class="text-body-2 text-medium-emphasis mt-1">
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

      <div v-if="!grupo.decisao" class="d-flex flex-wrap ga-2">
        <v-btn color="primary" :loading="agindo === grupo.id" :disabled="!nomesEscolhidos[grupo.id]" @click="unificar(grupo)">
          {{ grupo.flagJaNoPralis ? 'Vincular e atualizar na Base' : 'Adicionar à Base Geral' }}
        </v-btn>
        <v-btn variant="text" :disabled="!!agindo" @click="marcar(grupo, 'nao_e_o_mesmo')">Não é o mesmo produto</v-btn>
        <v-btn variant="text" color="grey" :disabled="!!agindo" @click="marcar(grupo, 'ignorado')">Ignorar</v-btn>
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
.central { max-width: 1180px; }
.busca { min-width: 280px; flex: 1 1 420px; }
.loja { max-width: 220px; min-width: 180px; }
.nome { max-width: 680px; }
</style>
