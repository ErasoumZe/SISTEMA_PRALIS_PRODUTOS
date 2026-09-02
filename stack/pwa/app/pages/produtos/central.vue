<script setup lang="ts">
import type { FiltrosUnificacao, GrupoUnificacao, PaginaGrupos, TotaisUnificacao } from '~/composables/useApi';

const api = useApi();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const MOTIVOS = [
  { valor: 'mesmo_cod_barras', rotulo: 'Mesmo código de barras', cor: 'success' },
  { valor: 'mesmo_cod_interno', rotulo: 'Mesmo código interno', cor: 'warning' },
  { valor: 'nome_parecido', rotulo: 'Nome parecido', cor: 'info' },
  { valor: 'unico', rotulo: 'Só numa fonte', cor: 'grey' },
] as const;

const FONTES: Record<string, string> = {
  sia_li: 'SIA (Lisboa)',
  compilart_tnp: 'Compilart (TNP)',
  planilha_tnp: 'Planilha antiga',
  fiscal_tnp: 'Fiscal contabilidade',
  pralis: 'Pralis',
};

const filtros = reactive<FiltrosUnificacao>({ pagina: 1, tamanho: 25, decisao: 'pendente' });
const dados = ref<PaginaGrupos | null>(null);
const totais = ref<TotaisUnificacao | null>(null);
const carregando = ref(false);
const erro = ref('');
const busca = ref('');
const flash = useFlash();

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    const [pagina, health] = await Promise.all([
      api.unificacaoGrupos({ ...filtros, q: busca.value || undefined }),
      api.unificacaoHealth(),
    ]);
    dados.value = pagina;
    totais.value = health.totais;
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar a central.';
  } finally {
    carregando.value = false;
  }
}

onMounted(carregar);
// mudar filtro volta para a primeira página: manter a 7 com outro filtro confunde
watch(() => [filtros.filtro, filtros.loja, filtros.status, filtros.revisar,
  filtros.semFiscalTnp, filtros.semGrupo, filtros.decisao], () => { filtros.pagina = 1; carregar(); });
watch(() => filtros.pagina, carregar);

let debounce: ReturnType<typeof setTimeout> | null = null;
watch(busca, () => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { filtros.pagina = 1; carregar(); }, 400);
});

/** Chip que liga/desliga um filtro sem virar um formulário. */
function alternar<K extends keyof FiltrosUnificacao>(chave: K, valor: FiltrosUnificacao[K]) {
  filtros[chave] = filtros[chave] === valor ? undefined : valor;
}

const agindo = ref('');

async function acao(g: GrupoUnificacao, tipo: 'unificar' | 'nao_e_o_mesmo' | 'ignorado') {
  agindo.value = g.id;
  try {
    if (tipo === 'unificar') await api.unificacaoUnificar(g.id);
    else await api.unificacaoMarcar(g.id, tipo);
    flash.value = {
      texto: tipo !== 'unificar'
        ? 'Decisão registrada.'
        : `"${g.candidato.nome}" ${g.flagJaNoPralis ? 'atualizado' : 'criado'} no cadastro do Pralis.`,
      tipo: 'success',
    };
    await carregar();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível concluir.',
      tipo: 'error',
    };
  } finally {
    agindo.value = '';
  }
}

const recarregando = ref(false);
async function recarregarFontes() {
  recarregando.value = true;
  try {
    await api.unificacaoCarregar();
    flash.value = { texto: 'Fontes recarregadas e grupos refeitos.', tipo: 'success' };
    await carregar();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível recarregar.',
      tipo: 'error',
    };
  } finally {
    recarregando.value = false;
  }
}

const mostrarFlash = computed({
  get: () => !!flash.value,
  set: (v: boolean) => { if (!v) flash.value = null; },
});

const brl = (v: number | string | null) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const corDoMotivo = (m: string) => MOTIVOS.find((x) => x.valor === m)?.cor ?? 'grey';
const rotuloDoMotivo = (m: string) => MOTIVOS.find((x) => x.valor === m)?.rotulo ?? m;

/** Vermelho onde as fontes discordam — é o que pede olho humano. */
const nomesDoGrupo = (g: GrupoUnificacao) =>
  [...new Set(g.itens.map((i) => i.nome).filter(Boolean))] as string[];
</script>

<template>
  <div>
    <v-alert v-if="!isAdmin" type="warning" variant="tonal" class="mb-4">
      Esta tela é do administrador.
    </v-alert>

    <template v-else>
      <!-- KPI da base TODA, não do catálogo vivo -->
      <div v-if="totais" class="d-flex flex-wrap ga-3 mb-4">
        <v-card v-for="k in [
          { r: 'Produtos únicos', v: totais.grupos, c: undefined },
          { r: 'A criar no Pralis', v: totais.aCriar, c: 'primary' },
          { r: 'Já no Pralis', v: totais.jaNoPralis, c: 'success' },
          { r: 'Sem fiscal TNP', v: totais.semFiscalTnp, c: 'warning' },
          { r: 'A classificar', v: totais.semGrupo, c: 'warning' },
          { r: 'Nomes divergentes', v: totais.nomesDivergentes, c: 'error' },
          { r: 'Falta decidir', v: totais.pendentes, c: undefined },
        ]" :key="k.r" flat border rounded="lg" class="pa-3" style="min-width: 150px; flex: 1 1 150px">
          <div class="text-caption text-medium-emphasis">{{ k.r }}</div>
          <div class="text-h5 font-weight-bold" :class="k.c ? `text-${k.c}` : ''">
            {{ k.v.toLocaleString('pt-BR') }}
          </div>
        </v-card>
      </div>

      <!-- filtros: todos operam no servidor, sobre a base inteira -->
      <v-card flat border rounded="lg" class="pa-3 mb-4">
        <div class="d-flex flex-wrap ga-2 align-center">
          <v-text-field
            v-model="busca"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            placeholder="Buscar por nome ou código"
            prepend-inner-icon="search"
            style="min-width: 240px; max-width: 340px"
          />
          <v-chip
            v-for="m in MOTIVOS"
            :key="m.valor"
            :color="filtros.filtro === m.valor ? m.cor : undefined"
            :variant="filtros.filtro === m.valor ? 'flat' : 'outlined'"
            size="small"
            @click="alternar('filtro', m.valor)"
          >{{ m.rotulo }}</v-chip>

          <v-divider vertical class="mx-1" />
          <v-chip
            v-for="l in ['LI', 'TNP']"
            :key="l"
            :color="filtros.loja === l ? 'primary' : undefined"
            :variant="filtros.loja === l ? 'flat' : 'outlined'"
            size="small"
            @click="alternar('loja', l)"
          >{{ l === 'LI' ? 'Lisboa' : 'TNP' }}</v-chip>

          <v-divider vertical class="mx-1" />
          <v-chip
            v-for="s in ['ativo', 'inativo']"
            :key="s"
            :color="filtros.status === s ? 'primary' : undefined"
            :variant="filtros.status === s ? 'flat' : 'outlined'"
            size="small"
            @click="alternar('status', s)"
          >{{ s === 'ativo' ? 'Ativos' : 'Inativos' }}</v-chip>

          <v-divider vertical class="mx-1" />
          <v-chip
            :color="filtros.revisar ? 'error' : undefined"
            :variant="filtros.revisar ? 'flat' : 'outlined'"
            size="small"
            @click="alternar('revisar', filtros.revisar ? undefined : true)"
          >Precisa revisar</v-chip>
          <v-chip
            :color="filtros.semFiscalTnp ? 'warning' : undefined"
            :variant="filtros.semFiscalTnp ? 'flat' : 'outlined'"
            size="small"
            @click="alternar('semFiscalTnp', filtros.semFiscalTnp ? undefined : true)"
          >Sem fiscal TNP</v-chip>
          <v-chip
            :color="filtros.semGrupo ? 'warning' : undefined"
            :variant="filtros.semGrupo ? 'flat' : 'outlined'"
            size="small"
            @click="alternar('semGrupo', filtros.semGrupo ? undefined : true)"
          >Sem grupo</v-chip>
          <v-chip
            :color="filtros.decisao === 'feita' ? 'success' : undefined"
            :variant="filtros.decisao === 'feita' ? 'flat' : 'outlined'"
            size="small"
            @click="filtros.decisao = filtros.decisao === 'pendente' ? 'feita' : 'pendente'"
          >{{ filtros.decisao === 'feita' ? 'Já decididos' : 'Falta decidir' }}</v-chip>

          <v-spacer />
          <v-btn
            size="small"
            variant="text"
            prepend-icon="refresh"
            :loading="recarregando"
            @click="recarregarFontes"
          >Recarregar fontes</v-btn>
        </div>
      </v-card>

      <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
      <div v-if="carregando" class="text-center py-8"><v-progress-circular indeterminate /></div>

      <template v-else-if="dados">
        <div class="text-body-2 text-medium-emphasis mb-2">
          {{ dados.total.toLocaleString('pt-BR') }} grupo(s) · página {{ dados.pagina }} de {{ dados.paginas || 1 }}
        </div>

        <v-alert v-if="!dados.grupos.length" type="info" variant="tonal">
          Nenhum grupo com esses filtros.
        </v-alert>

        <v-card
          v-for="g in dados.grupos"
          :key="g.id"
          flat
          border
          rounded="lg"
          class="pa-4 mb-3"
        >
          <div class="d-flex align-center flex-wrap ga-2 mb-2">
            <div style="min-width: 0">
              <div class="text-body-1 font-weight-bold text-truncate">
                {{ g.candidato.nome || '(sem nome em nenhuma fonte)' }}
              </div>
              <div class="text-caption text-medium-emphasis">
                {{ g.chave }} ·
                {{ g.candidato.grupo || 'A CLASSIFICAR' }}
                <span v-if="g.candidato.grupoDe"> (do {{ FONTES[g.candidato.grupoDe] }})</span>
              </div>
            </div>
            <v-spacer />
            <v-chip size="x-small" :color="corDoMotivo(g.motivo)" variant="tonal">
              {{ rotuloDoMotivo(g.motivo) }}
            </v-chip>
            <v-chip v-if="!g.ativo" size="x-small" variant="tonal">inativo</v-chip>
            <v-chip v-if="g.flagJaNoPralis" size="x-small" color="success" variant="tonal">já no Pralis</v-chip>
          </div>

          <!-- o que pede olho humano, em vermelho -->
          <div v-if="g.flagNomesDivergentes || g.flagBarrasConflitante || g.flagSemFiscalTnp || g.flagSemGrupo"
               class="d-flex flex-wrap ga-2 mb-3">
            <v-chip v-if="g.flagNomesDivergentes" size="x-small" color="error" variant="flat">
              nomes diferentes: {{ nomesDoGrupo(g).join(' | ') }}
            </v-chip>
            <v-chip v-if="g.flagBarrasConflitante" size="x-small" color="error" variant="flat">
              código de barras cobre produtos diferentes na origem
            </v-chip>
            <v-chip v-if="g.flagSemFiscalTnp" size="x-small" color="warning" variant="flat">
              sem fiscal da contabilidade (TNP)
            </v-chip>
            <v-chip v-if="g.flagSemGrupo" size="x-small" color="warning" variant="flat">
              sem grupo — entra como A CLASSIFICAR
            </v-chip>
          </div>

          <!-- as fontes lado a lado -->
          <div style="overflow-x: auto">
            <v-table density="compact">
              <thead>
                <tr>
                  <th class="text-left">Fonte</th>
                  <th class="text-left">Loja</th>
                  <th class="text-left">Produto</th>
                  <th class="text-left">Cód. barras</th>
                  <th class="text-left">Interno</th>
                  <th class="text-right">Custo</th>
                  <th class="text-right">V. venda</th>
                  <th class="text-left">NCM</th>
                  <th class="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(i, idx) in g.itens" :key="idx">
                  <td class="text-caption">{{ FONTES[i.fonte] || i.fonte }}</td>
                  <td class="text-caption">{{ i.loja }}</td>
                  <td :class="g.flagNomesDivergentes ? 'text-error' : ''">{{ i.nome || '—' }}</td>
                  <td class="text-caption">{{ i.codBarras || '—' }}</td>
                  <td class="text-caption">{{ i.codInterno || '—' }}</td>
                  <td class="text-right">{{ brl(i.custo) }}</td>
                  <td class="text-right">{{ brl(i.venda) }}</td>
                  <td class="text-caption">{{ i.ncm || '—' }}</td>
                  <td class="text-caption">
                    {{ i.ativo === null ? '—' : (i.ativo ? 'ativo' : 'inativo') }}
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <!-- o que será gravado, com a fonte de cada campo -->
          <div class="text-caption text-medium-emphasis mt-3">
            Vai gravar: <strong>{{ g.candidato.nome }}</strong> (do {{ FONTES[g.candidato.nomeDe] }}) ·
            custo {{ brl(g.candidato.custo) }}<span v-if="g.candidato.custoDe"> (do {{ FONTES[g.candidato.custoDe] }})</span> ·
            venda {{ brl(g.candidato.venda) }} ·
            fiscal LI {{ g.candidato.fiscalLi ? 'do SIA' : '—' }},
            fiscal TNP {{ g.candidato.fiscalTnp ? 'da contabilidade' : 'ausente' }}
          </div>

          <div v-if="g.decisao" class="text-caption mt-2">
            <v-chip size="x-small" variant="tonal">{{ g.decisao }}</v-chip>
            <span v-if="g.decididoPor" class="ml-1">por {{ g.decididoPor }}</span>
          </div>

          <div v-else class="d-flex flex-wrap ga-2 mt-3">
            <!--
              Grupo que já existe no Pralis é ATUALIZADO, não recriado. O rótulo
              precisa dizer isso: "criar" num produto que já existe assusta, e
              foi justamente o que gerava o erro de duplicado.
            -->
            <v-btn
              size="small"
              color="primary"
              variant="flat"
              :loading="agindo === g.id"
              @click="acao(g, 'unificar')"
            >{{ g.flagJaNoPralis ? 'Unificar e atualizar no Pralis' : 'Unificar e criar no Pralis' }}</v-btn>
            <v-btn
              v-if="g.itens.length > 1"
              size="small"
              variant="text"
              :loading="agindo === g.id"
              @click="acao(g, 'nao_e_o_mesmo')"
            >Não é o mesmo</v-btn>
            <v-btn
              size="small"
              variant="text"
              :loading="agindo === g.id"
              @click="acao(g, 'ignorado')"
            >Ignorar</v-btn>
          </div>
        </v-card>

        <v-pagination
          v-if="dados.paginas > 1"
          v-model="filtros.pagina"
          :length="dados.paginas"
          :total-visible="5"
          density="comfortable"
          class="mt-4"
        />
      </template>
    </template>

    <v-snackbar v-model="mostrarFlash" :color="flash?.tipo" timeout="4000">
      {{ flash?.texto }}
    </v-snackbar>
  </div>
</template>
