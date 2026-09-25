<script setup lang="ts">
import type { MotivoRecusaCarga, PreviaCarga } from '~/composables/useApi';

/**
 * CARGA DA BASE — põe no sistema todos os produtos da planilha.
 *
 * A tela existe para uma coisa: deixar conferir ANTES. A carga zera a Base e
 * grava 7 mil cadastros de uma vez, e a pior falha possível aqui é silenciosa —
 * coluna trocada de lugar grava custo no campo de preço sem erro nenhum. Por
 * isso o mapeamento das colunas aparece escrito na tela, e não só no código.
 */
const api = useApi();
const flash = useFlash();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const dados = ref<PreviaCarga | null>(null);
const carregando = ref(false);
const importando = ref(false);
const erro = ref('');
const confirmacao = ref('');
const confirmacaoVinculo = ref('');
const vinculando = ref(false);

/** O mapeamento, como o José fechou. Escrito aqui para poder ser conferido. */
const MAPA: Array<{ coluna: string; titulo: string; vira: string }> = [
  { coluna: 'C', titulo: 'ATIVO / INATIVO', vira: 'Situação do cadastro' },
  { coluna: 'D', titulo: 'CADASTRO PRODUTOS ATUALIZADO NOVO', vira: 'Nome' },
  { coluna: 'F', titulo: 'CODIGO BARRAS', vira: 'Código de barras' },
  { coluna: 'H', titulo: 'EMB', vira: 'Unidade de medida' },
  { coluna: 'M', titulo: 'GRUPO MERCADORIAS', vira: 'Nome do grupo' },
  { coluna: 'X', titulo: 'CODIGO INT.', vira: 'Código interno do PDV' },
  { coluna: 'Z', titulo: 'ESTOQUE MIN', vira: 'Estoque mínimo' },
  { coluna: 'AB', titulo: 'ESTOQUE MAX', vira: 'Estoque máximo' },
  { coluna: 'AE', titulo: 'CUSTO', vira: 'Custo' },
  { coluna: 'AH', titulo: 'V. VENDA PONTUAL', vira: 'Preço de venda' },
  { coluna: 'HX', titulo: 'ID GRUPO', vira: 'Código do grupo no Creare' },
];

const MOTIVO: Record<MotivoRecusaCarga, string> = {
  'codigo-invalido': 'Código interno fora da faixa que o PDV aceita',
  'codigo-repetido-na-planilha': 'O mesmo código interno aparece em duas linhas',
  'sem-nome': 'A linha não tem descrição',
  'situacao-desconhecida': 'A coluna C não diz ATIVO nem INATIVO',
  'unidade-desconhecida': 'Unidade que o cadastro não conhece',
  'sem-id-de-grupo': 'Sem id de grupo, e o arquivo do Creare exige',
};

const AVISO: Record<Exclude<PreviaCarga['estado'], 'ok'>, string> = {
  'sem-destino': 'Falta a variável GOOGLE_SHEETS_SPREADSHEET_ID no ambiente. Sem ela a tela não lê nada, de propósito, para não ler a planilha errada.',
  'coluna-mudou': 'O cabeçalho da planilha saiu do lugar. A carga não roda assim: com a coluna trocada, o dado entraria no campo errado sem dar erro nenhum.',
  falhou: 'O Google recusou a leitura. Pode ser credencial, permissão ou indisponibilidade. Nada foi alterado.',
};

const fraseOk = computed(() => confirmacao.value.trim().toUpperCase() === (dados.value?.confirmacao ?? ''));
const fraseVinculoOk = computed(() => confirmacaoVinculo.value.trim().toUpperCase() === (dados.value?.confirmacaoVinculo ?? ''));
/** Produtos da Base que ainda não sabem em que linha da planilha moram. */
const semVinculo = computed(() => Math.max(0, (dados.value?.apagar ?? 0) - (dados.value?.vinculados ?? 0)));
const recusas = computed(() => (Object.entries(dados.value?.recusas ?? {}) as Array<[MotivoRecusaCarga, number]>)
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1]));
const totalRecusado = computed(() => recusas.value.reduce((a, [, n]) => a + n, 0));
const semNomeDeGrupo = computed(() => (dados.value?.porGrupo ?? []).filter((g) => !g.grupo));
const deTransformacao = computed(() => (dados.value?.porGrupo ?? [])
  .filter((g) => g.tipo === 'transformacao').reduce((a, g) => a + g.quantidade, 0));

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR');
const dinheiro = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.cargaBasePrevia();
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível montar a prévia.';
  } finally {
    carregando.value = false;
  }
}

onMounted(() => { void carregar(); });

async function vincular() {
  if (!fraseVinculoOk.value) return;
  vinculando.value = true;
  try {
    const r = await api.cargaBaseVincular(confirmacaoVinculo.value);
    const extras = [
      r.jaVinculadas ? `${n(r.jaVinculadas)} já estavam` : '',
      r.codigosRepetidos.length ? `${r.codigosRepetidos.length} código(s) repetido(s) ficaram de fora` : '',
    ].filter(Boolean).join('; ');
    flash.value = {
      texto: `${n(r.vinculadas)} linha(s) ligadas ao produto${extras ? `. ${extras}.` : '.'}`,
      tipo: r.codigosRepetidos.length ? 'warning' : 'success',
    };
    confirmacaoVinculo.value = '';
    await carregar();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível vincular as linhas.',
      tipo: 'error',
    };
  } finally {
    vinculando.value = false;
  }
}

async function importar() {
  if (!fraseOk.value) return;
  importando.value = true;
  try {
    const r = await api.cargaBaseImportar(confirmacao.value);
    flash.value = {
      texto: `Base carregada: ${n(r.criados)} produtos, ${n(r.ativos)} ativos e ${n(r.inativos)} inativos.`,
      tipo: 'success',
    };
    confirmacao.value = '';
    await carregar();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível carregar a Base.',
      tipo: 'error',
    };
  } finally {
    importando.value = false;
  }
}
</script>

<template>
  <v-container class="py-6" style="max-width: 1100px">
    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <div>
        <h1 class="text-h5 mb-1">Importar da planilha</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Zera a Base e traz todos os produtos da planilha, iguais ao que está lá.
        </p>
      </div>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">
        Recarregar
      </v-btn>
    </div>

    <v-alert v-if="!isAdmin" type="warning" variant="tonal" class="mb-4">
      Esta tela é restrita ao administrador: ela refaz o cadastro da rede inteira.
    </v-alert>

    <v-alert v-else-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <template v-else-if="dados">
      <v-alert v-if="dados.estado !== 'ok'" type="error" variant="tonal" class="mb-4">
        <div class="text-body-2">{{ AVISO[dados.estado] }}</div>
        <v-table v-if="dados.trocadas.length" density="compact" class="mt-3 bg-transparent">
          <thead>
            <tr><th>Coluna</th><th>Esperava</th><th>Achou</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in dados.trocadas" :key="t.coluna">
              <td class="font-weight-medium">{{ t.coluna }}</td>
              <td>{{ t.esperado }}</td>
              <td>{{ t.encontrado }}</td>
            </tr>
          </tbody>
        </v-table>
        <div v-if="dados.erro" class="text-body-2 mt-2 text-medium-emphasis">{{ dados.erro }}</div>
      </v-alert>

      <template v-else>
        <v-alert v-if="dados.truncada" type="warning" variant="tonal" class="mb-4">
          A leitura chegou ao fim da janela configurada e pode haver produto além dela.
          Aumente <code>GOOGLE_SHEETS_CARGA_LINHA_FINAL</code> antes de carregar, senão
          parte da planilha fica de fora sem aviso.
        </v-alert>

        <v-row dense class="mb-4">
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5">{{ n(dados.importar) }}</div>
              <div class="text-caption">Produtos entram</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5 text-success">{{ n(dados.ativos) }}</div>
              <div class="text-caption">Entram ativos</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5 text-medium-emphasis">{{ n(dados.inativos) }}</div>
              <div class="text-caption">Entram inativos</div>
            </v-card>
          </v-col>
          <v-col cols="6" md="3">
            <v-card flat border rounded="lg" class="pa-4">
              <div class="text-h5" :class="dados.apagar ? 'text-error' : ''">{{ n(dados.apagar) }}</div>
              <div class="text-caption">Saem da Base antes</div>
            </v-card>
          </v-col>
        </v-row>

        <v-alert
          :type="totalRecusado ? 'warning' : 'success'"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          <span v-if="totalRecusado">
            {{ n(totalRecusado) }} linha(s) não entram. A carga só faz sentido com todas,
            então resolva na planilha antes de confirmar.
          </span>
          <span v-else>
            Nenhuma linha ficou de fora: as {{ n(dados.linhasLidas) }} linhas com produto entram.
          </span>
        </v-alert>

        <v-card v-if="recusas.length" flat border rounded="lg" class="mb-4">
          <v-card-title class="text-subtitle-1">Quem não entra, e por quê</v-card-title>
          <v-list density="compact">
            <v-list-item v-for="[motivo, qtd] in recusas" :key="motivo">
              <template #prepend>
                <v-chip size="small" variant="tonal" color="warning" class="mr-3">{{ n(qtd) }}</v-chip>
              </template>
              <v-list-item-title class="text-body-2">{{ MOTIVO[motivo] }}</v-list-item-title>
            </v-list-item>
          </v-list>
          <v-divider />
          <v-list density="compact" lines="two">
            <v-list-item v-for="d in dados.recusadas.slice(0, 20)" :key="`${d.linha}-${d.codigo}`">
              <v-list-item-title class="text-body-2">
                <v-chip size="x-small" variant="tonal" class="mr-2">{{ d.codigo || '—' }}</v-chip>
                {{ d.nome || '(sem nome)' }}
              </v-list-item-title>
              <v-list-item-subtitle>
                linha {{ d.linha }} · {{ d.motivo ? MOTIVO[d.motivo] : '' }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>

        <v-card flat border rounded="lg" class="mb-4">
          <v-card-title class="text-subtitle-1">De onde vem cada campo</v-card-title>
          <v-card-subtitle class="pb-2">
            A leitura confere estes títulos antes de começar. Se algum sair do lugar,
            ela para em vez de gravar no campo errado.
          </v-card-subtitle>
          <v-table density="compact">
            <thead>
              <tr><th style="width: 70px">Coluna</th><th>Título na planilha</th><th>Vira no cadastro</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in MAPA" :key="m.coluna">
                <td><v-chip size="x-small" variant="tonal">{{ m.coluna }}</v-chip></td>
                <td class="text-caption">{{ m.titulo }}</td>
                <td class="text-body-2">{{ m.vira }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>

        <v-alert type="info" variant="tonal" density="compact" class="mb-4">
          O bloco fiscal inteiro entra com <strong>sequências de zero</strong>, no tamanho
          que o arquivo do Creare exige, e cada produto fica marcado como fiscal pendente.
          Campo que a planilha deixou em branco entra <strong>vazio</strong>, nunca como zero.
          Nada é escrito de volta na planilha.
        </v-alert>

        <v-card v-if="dados.barrasRepetidas.length" flat border rounded="lg" class="mb-4">
          <v-card-title class="text-subtitle-1">
            Código de barras repetido ({{ dados.barrasRepetidas.length }})
          </v-card-title>
          <v-card-subtitle class="pb-2">
            Entram assim mesmo, porque você pediu todos os produtos. Mas o caixa bipa um
            código e espera um produto só.
          </v-card-subtitle>
          <v-list density="compact">
            <v-list-item v-for="b in dados.barrasRepetidas.slice(0, 20)" :key="b.codigoBarras">
              <v-list-item-title class="text-body-2">
                <v-chip size="x-small" variant="tonal" color="warning" class="mr-2">{{ b.codigoBarras }}</v-chip>
                nos códigos {{ b.codigos.join(', ') }}
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>

        <v-card flat border rounded="lg" class="mb-4">
          <v-card-title class="text-subtitle-1">
            Grupos ({{ dados.porGrupo.length }})
          </v-card-title>
          <v-card-subtitle class="pb-2">
            {{ n(deTransformacao) }} produtos entram como fabricação própria; o resto como revenda.
            <span v-if="semNomeDeGrupo.length">
              {{ semNomeDeGrupo.length }} grupos não têm nome na coluna M e entram só com o id.
            </span>
          </v-card-subtitle>
          <v-table density="compact" fixed-header height="320">
            <thead>
              <tr><th style="width: 70px">Id</th><th>Grupo</th><th>Tipo</th><th class="text-right">Produtos</th></tr>
            </thead>
            <tbody>
              <tr v-for="g in dados.porGrupo" :key="g.grupoId">
                <td><v-chip size="x-small" variant="tonal">{{ g.grupoId }}</v-chip></td>
                <td class="text-body-2">
                  <span v-if="g.grupo">{{ g.grupo }}</span>
                  <span v-else class="text-medium-emphasis font-italic">sem nome na coluna M</span>
                </td>
                <td>
                  <v-chip size="x-small" variant="tonal" :color="g.tipo === 'transformacao' ? 'primary' : undefined">
                    {{ g.tipo === 'transformacao' ? 'fabricação própria' : 'revenda' }}
                  </v-chip>
                </td>
                <td class="text-right">{{ n(g.quantidade) }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>

        <v-card v-if="dados.amostra.length" flat border rounded="lg" class="mb-4">
          <v-card-title class="text-subtitle-1">
            Como os primeiros {{ dados.amostra.length }} entrariam
          </v-card-title>
          <v-table density="compact">
            <thead>
              <tr>
                <th>Código</th><th>Nome</th><th>Barras</th><th>Un.</th>
                <th class="text-right">Custo</th><th class="text-right">Venda</th><th>Situação</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in dados.amostra" :key="p.codigoInterno">
                <td><v-chip size="x-small" variant="tonal">{{ p.codigoInterno }}</v-chip></td>
                <td class="text-body-2">{{ p.nome }}</td>
                <td class="text-caption">{{ p.codigoBarras ?? '—' }}</td>
                <td class="text-caption">{{ p.medidaBase }}</td>
                <td class="text-right text-caption">{{ dinheiro(p.custo) }}</td>
                <td class="text-right text-caption">{{ dinheiro(p.precoVenda) }}</td>
                <td>
                  <v-chip size="x-small" variant="tonal" :color="p.status === 'ativo' ? 'success' : undefined">
                    {{ p.status }}
                  </v-chip>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>

        <v-card v-if="dados.apagar" flat border rounded="lg" class="pa-4 mb-4">
          <div class="d-flex flex-wrap align-center ga-3 mb-2">
            <div class="text-subtitle-1">Ligar as linhas da planilha aos produtos</div>
            <v-spacer />
            <v-chip
              size="small"
              variant="tonal"
              :color="semVinculo ? 'warning' : 'success'"
            >
              {{ n(dados.vinculados) }} de {{ n(dados.apagar) }} ligadas
            </v-chip>
          </div>
          <p class="text-body-2 text-medium-emphasis mb-3">
            O sistema descobre em que linha da planilha mora cada produto por um identificador
            gravado numa coluna dela. Sem esse identificador, importar da base para uma loja
            <strong>abre linha nova no fim</strong> em vez de preencher a linha que o produto já
            ocupa, e a planilha ganha produto repetido. Esta ação grava só essa coluna:
            não cria linha, não toca em mais nada e não apaga identificador que já exista.
          </p>
          <v-alert v-if="!semVinculo" type="success" variant="tonal" density="compact" class="mb-0">
            Todos os produtos da Base já sabem a linha deles. Importar para a loja preenche a linha certa.
          </v-alert>
          <template v-else>
            <v-alert type="warning" variant="tonal" density="compact" class="mb-3">
              {{ n(semVinculo) }} produto(s) ainda sem linha conhecida. Enquanto isso,
              cada importação para a loja cria uma linha repetida na planilha.
            </v-alert>
            <div class="d-flex flex-wrap align-center ga-3">
              <v-text-field
                v-model="confirmacaoVinculo"
                :label="`Digite: ${dados.confirmacaoVinculo}`"
                density="compact" hide-details variant="outlined"
                style="min-width: 340px; max-width: 480px"
              />
              <v-btn
                color="primary"
                :disabled="!fraseVinculoOk"
                :loading="vinculando"
                prepend-icon="link"
                @click="vincular"
              >
                Ligar {{ n(semVinculo) }} linha(s)
              </v-btn>
            </div>
          </template>
        </v-card>

        <v-card flat border rounded="lg" class="pa-4">
          <v-alert type="error" variant="tonal" density="compact" class="mb-3">
            Carregar <strong>apaga os {{ n(dados.apagar) }} cadastros da Base</strong> e grava
            os {{ n(dados.importar) }} da planilha no lugar. É tudo ou nada: se algo falhar,
            nada muda. O cadastro próprio de TNP e LI não é tocado.
          </v-alert>
          <div class="d-flex flex-wrap align-center ga-3">
            <v-text-field
              v-model="confirmacao"
              :label="`Digite: ${dados.confirmacao}`"
              density="compact" hide-details variant="outlined"
              style="min-width: 360px; max-width: 520px"
            />
            <v-btn
              color="error"
              :disabled="!fraseOk || dados.importar === 0"
              :loading="importando"
              prepend-icon="database"
              @click="importar"
            >
              Zerar e carregar {{ n(dados.importar) }}
            </v-btn>
          </div>
        </v-card>
      </template>
    </template>

    <v-skeleton-loader v-else-if="carregando" type="card" class="mt-4" />
  </v-container>
</template>
