<script setup lang="ts">
import type { BaldeCodigo, BaldeEmLote, ItemCodigoCadastro, PreviaCodigoCadastro } from '~/composables/useApi';

/**
 * Reconciliação do código de cadastro com o `coditem` do SIA.
 *
 * A numeração da rede é a do PDV: o `COD INTERNO` da planilha MIX e o `coditem`
 * do SIA são o mesmo número (medido em 18/09/2026: 2.962 linhas com código E
 * nome iguais). E o `codigo_interno` do Pralis alimenta o TXT do Creare — o
 * gerador RECUSA o produto quando os dois divergem. Alinhar não é arrumação:
 * é o que faz a exportação voltar a exportar.
 *
 * Só o balde `exato` é adotado sem clique. O resto é decisão humana, item a
 * item, porque cunhar código novo não tem volta.
 */
const api = useApi();
const flash = useFlash();
const { user, podeVer } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const dados = ref<PreviaCodigoCadastro | null>(null);
const carregando = ref(false);
const erro = ref('');
const confirmacao = ref('');
const aplicando = ref(false);
const decidindo = ref<string | null>(null);

const BALDES: Array<{ id: BaldeCodigo; titulo: string; ajuda: string }> = [
  {
    id: 'exato',
    titulo: 'Pronto para adotar',
    ajuda: 'O código de barras casa com um produto do SIA e nenhum outro cadastro disputa esse código. É o único balde adotado de uma vez.',
  },
  {
    id: 'barras-tem-codigo',
    titulo: 'Código está nas barras',
    ajuda: 'O SIA grava o código do produto no campo do código de barras quando ele não tem etiqueta — 00000000012067 é o produto 12067. Aqui o de-para carregado NÃO lista esse código, sinal de que a exportação do SIA está atrasada. O número está certo; confira alguns antes de adotar o lote, e reenvie um de-para novo quando puder.',
  },
  {
    id: 'conflito-sia',
    titulo: 'Precisa de você',
    ajuda: 'Ou as lojas discordam do código no SIA, ou o número deste produto é curto demais para ser código de barras e casou por coincidência.',
  },
  {
    id: 'disputado',
    titulo: 'Dois cadastros, um código',
    ajuda: 'Dois produtos do Pralis apontam para o mesmo código do PDV — quase sempre cadastro duplicado. Unifique na Central antes de numerar.',
  },
  {
    id: 'fora-do-sia',
    titulo: 'Falta no PDV',
    ajuda: 'O produto já tem código da rede — veio da planilha — mas o PDV ainda não o cadastrou. Não há nada a fazer aqui: o código está certo, e cunhar um novo quebraria o alinhamento. Eles somem deste balde quando a loja cadastrar o produto no SIA e você reenviar o de-para.',
  },
  {
    id: 'novo',
    titulo: 'Sem código da rede',
    ajuda: 'Não casa por código de barras e o código atual não é da faixa da rede. Quando o nome se parece com algum produto do SIA, a sugestão aparece com a % de parecença — confira o nome antes de clicar. Cunhar só quando nenhuma sugestão servir: cria numeração nova PARA SEMPRE.',
  },
  {
    id: 'ja-correto',
    titulo: 'Já está certo',
    ajuda: 'O produto já está com o código do PDV. Nada a fazer.',
  },
];

const visao = ref<BaldeCodigo>('exato');
const busca = ref('');

/**
 * Busca: enquanto há termo, procura em TODOS os baldes.
 *
 * Antes ela filtrava só o balde aberto, e isso enganava: o José procurou
 * "farinha alvear" com "Sem código da rede" na tela, não achou nada e concluiu
 * que o produto não tinha sido importado — quando ele estava em "Já está
 * certo", a dois cliques dali. Uma busca que responde "nada encontrado" sobre
 * um produto que existe é pior do que não ter busca.
 */
const buscando = computed(() => busca.value.trim().length > 0);

const itens = computed<ItemCodigoCadastro[]>(() => {
  const termo = busca.value.trim().toLowerCase();
  const todos = dados.value?.itens ?? [];
  if (!termo) return todos.filter((i) => i.balde === visao.value);
  return todos.filter((i) => i.nome.toLowerCase().includes(termo)
    || (i.codigoBarras ?? '').includes(termo)
    || (i.codigoAtual ?? '').includes(termo));
});

/** O título do balde de cada item, para a busca global dizer onde ele está. */
const tituloDoBalde = (balde: BaldeCodigo) => BALDES.find((b) => b.id === balde)?.titulo ?? balde;

const conta = (balde: BaldeCodigo) => dados.value?.resumo?.[balde] ?? 0;
const fraseOk = computed(() => confirmacao.value.trim().toUpperCase() === (dados.value?.confirmacao ?? ''));
const semParesSia = computed(() => !!dados.value && dados.value.paresSia === 0);

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.codigoCadastroPrevia();
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Não foi possível montar a prévia.';
  } finally {
    carregando.value = false;
  }
}

onMounted(() => { void carregar(); });

function avisar(texto: string, tipo: 'success' | 'warning' | 'error') {
  flash.value = { texto, tipo };
}

async function adotarExatos(balde: BaldeEmLote) {
  if (!fraseOk.value) return;
  aplicando.value = true;
  try {
    const r = await api.codigoCadastroAdotarExatos(confirmacao.value, balde);
    const extras = [
      r.conflitos ? `${r.conflitos} mudaram no meio do caminho` : '',
      r.restantes ? `faltam ${r.restantes} — clique de novo` : '',
    ].filter(Boolean).join('; ');
    avisar(
      `${r.aplicadas} código(s) adotado(s)${extras ? `. ${extras}.` : '.'}`,
      r.conflitos || r.restantes ? 'warning' : 'success',
    );
    await carregar();
  } catch (e: unknown) {
    avisar((e as { data?: { message?: string } })?.data?.message || 'Não foi possível adotar.', 'error');
  } finally {
    aplicando.value = false;
  }
}

async function decidir(item: ItemCodigoCadastro, corpo: { codigo?: string; cunhar?: boolean }) {
  if (!fraseOk.value) {
    avisar('Digite a frase de confirmação antes de gravar.', 'error');
    return;
  }
  decidindo.value = item.productId;
  try {
    const r = await api.codigoCadastroDecidir({
      productId: item.productId,
      // o que ESTA tela viu: é o que impede sobrescrever quem decidiu antes
      codigoAtualEsperado: item.codigoAtual,
      ...corpo,
      confirmacao: confirmacao.value,
    });
    avisar(`${item.nome}: código ${r.codigo}.`, 'success');
    await carregar();
  } catch (e: unknown) {
    avisar((e as { data?: { message?: string } })?.data?.message || 'Não foi possível gravar.', 'error');
  } finally {
    decidindo.value = null;
  }
}
</script>

<template>
  <v-container class="py-6" style="max-width: 1200px">
    <div class="d-flex flex-wrap align-center ga-3 mb-2">
      <div>
        <h1 class="text-h5 mb-1">Código de cadastro</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          O código do produto no Pralis passa a ser o mesmo do PDV. Enquanto eles
          divergem, o produto é recusado na exportação para o Creare.
        </p>
      </div>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">
        Recarregar
      </v-btn>
    </div>

    <v-alert v-if="!isAdmin" type="warning" variant="tonal" class="mb-4">
      Esta tela é restrita ao administrador: o código vale para a rede inteira.
    </v-alert>

    <v-alert v-else-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <template v-else-if="dados">
      <v-alert v-if="semParesSia" type="warning" variant="tonal" class="mb-4">
        <div class="font-weight-medium">O de-para do SIA está vazio</div>
        <div class="text-body-2">
          Sem ele não há régua de numeração: todo produto cai em "sem par" e a
          tela não tem o que propor. Importe com <code>npm run creare:depara</code>
          antes de decidir qualquer coisa aqui.
        </div>
      </v-alert>

      <v-card flat border rounded="lg" class="pa-3 mb-4">
        <div class="text-body-2 text-medium-emphasis">
          {{ dados.paresSia.toLocaleString('pt-BR') }} produtos no de-para do SIA ·
          teto da numeração <strong>{{ dados.teto.toLocaleString('pt-BR') }}</strong>
          (de {{ dados.tetoDe }}) ·
          o próximo cunhado seria <strong>{{ (dados.teto + 1).toLocaleString('pt-BR') }}</strong>
          <span v-if="dados.planilha.estado !== 'ok'">
            · planilha MIX não lida ({{ dados.planilha.estado }}), o teto veio das outras fontes
          </span>
        </div>
      </v-card>

      <v-row dense class="mb-2">
        <v-col v-for="b in BALDES" :key="b.id" cols="6" md="auto" class="flex-grow-1">
          <v-card
            flat border rounded="lg" class="pa-3"
            :color="visao === b.id ? 'primary' : undefined"
            :variant="visao === b.id ? 'tonal' : undefined"
            style="cursor: pointer"
            @click="visao = b.id"
          >
            <div class="text-h6">{{ conta(b.id).toLocaleString('pt-BR') }}</div>
            <div class="text-caption">{{ b.titulo }}</div>
          </v-card>
        </v-col>
      </v-row>

      <v-alert type="info" variant="tonal" density="compact" class="mb-4">
        {{ BALDES.find((b) => b.id === visao)?.ajuda }}
      </v-alert>

      <v-card flat border rounded="lg" class="pa-3 mb-4">
        <div class="text-body-2 mb-2">
          Nada é gravado sem esta frase. Ela existe porque trocar código mexe em
          etiqueta impressa, na coluna <code>AC</code> da planilha oficial e no
          que o PDV recebe.
        </div>
        <div class="d-flex flex-wrap align-center ga-3">
          <v-text-field
            v-model="confirmacao"
            :label="`Digite: ${dados.confirmacao}`"
            density="compact" hide-details variant="outlined"
            style="min-width: 320px; max-width: 420px"
          />
          <!--
            Um botão por balde adotável, e nunca os dois no mesmo clique:
            `exato` o de-para confirma, `barras-tem-codigo` não. Graus de
            certeza diferentes merecem decisões diferentes.
          -->
          <v-btn
            v-if="visao === 'exato' || visao === 'barras-tem-codigo'"
            :color="visao === 'exato' ? 'primary' : 'warning'"
            :disabled="!fraseOk || conta(visao) === 0"
            :loading="aplicando"
            prepend-icon="done_all"
            @click="adotarExatos(visao)"
          >
            Adotar {{ Math.min(conta(visao), dados.loteMaximo) }}
            <span v-if="conta(visao) > dados.loteMaximo" class="ml-1">
              de {{ conta(visao) }}
            </span>
          </v-btn>
        </div>
      </v-card>

      <v-text-field
        v-model="busca" label="Buscar por nome, código de barras ou código atual"
        density="compact" variant="outlined" clearable hide-details class="mb-3"
        prepend-inner-icon="search"
      />

      <v-card flat border rounded="lg">
        <v-list lines="two">
          <template v-for="(item, i) in itens" :key="item.productId">
            <v-divider v-if="i > 0" />
            <v-list-item>
              <v-list-item-title class="d-flex flex-wrap align-center ga-2">
                <span class="font-weight-medium">{{ item.nome }}</span>
                <!-- Buscando, o resultado vem de qualquer balde: diga de qual. -->
                <v-chip v-if="buscando" size="x-small" variant="flat" color="primary">
                  {{ tituloDoBalde(item.balde) }}
                </v-chip>
                <v-chip size="x-small" variant="tonal">{{ item.loja }}</v-chip>
                <v-chip size="x-small" variant="tonal">atual: {{ item.codigoAtual || '—' }}</v-chip>
                <v-chip v-if="item.codigoBarras" size="x-small" variant="text">
                  {{ item.codigoBarras }}
                </v-chip>
              </v-list-item-title>

              <v-list-item-subtitle class="mt-1">{{ item.motivo }}</v-list-item-subtitle>

              <div class="d-flex flex-wrap align-center ga-2 mt-2">
                <!--
                  `barras-tem-codigo` não tem candidato do de-para: o código veio
                  do próprio cadastro. Sem este botão só restaria o lote, e quem
                  quer conferir um a um ficaria sem saída.
                -->
                <v-btn
                  v-if="item.balde === 'barras-tem-codigo' && item.codigoProposto"
                  size="small" variant="tonal" color="warning"
                  :loading="decidindo === item.productId"
                  :disabled="!fraseOk"
                  @click="decidir(item, { codigo: item.codigoProposto })"
                >
                  Adotar {{ item.codigoProposto }}
                  <span class="text-medium-emphasis ml-1">· lido do código de barras</span>
                </v-btn>

                <v-btn
                  v-for="c in item.candidatos"
                  :key="`${c.loja}:${c.coditem}`"
                  size="small" variant="tonal"
                  :color="c.semelhanca === undefined ? 'primary' : 'warning'"
                  :loading="decidindo === item.productId"
                  :disabled="!fraseOk || item.balde === 'ja-correto' || item.balde === 'disputado'"
                  @click="decidir(item, { codigo: c.coditem })"
                >
                  Adotar {{ c.coditem }}
                  <!--
                    A semelhança só aparece quando o candidato veio do NOME.
                    Casamento por código de barras não é parecido, é igual — pôr
                    um "100%" ali faria os dois parecerem a mesma coisa.
                  -->
                  <span v-if="c.semelhanca !== undefined" class="font-weight-bold ml-1">
                    {{ c.semelhanca }}%
                  </span>
                  <span class="text-medium-emphasis ml-1">· {{ c.loja }} · {{ c.descricao }}</span>
                </v-btn>

                <v-btn
                  v-if="item.balde === 'novo'"
                  size="small"
                  variant="flat"
                  color="warning"
                  :loading="decidindo === item.productId"
                  :disabled="!fraseOk"
                  @click="decidir(item, { cunhar: true })"
                >
                  Cunhar código novo
                </v-btn>

                <v-btn
                  v-if="item.balde === 'disputado' && podeVer('central-de-produtos')"
                  size="small" variant="text" color="primary"
                  to="/produtos/central"
                >
                  Resolver na Central
                </v-btn>
              </div>
            </v-list-item>
          </template>

          <v-list-item v-if="itens.length === 0">
            <v-list-item-title class="text-medium-emphasis">
              {{ busca ? 'Nada encontrado com esse termo.' : 'Nenhum produto neste balde.' }}
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card>
    </template>

    <v-skeleton-loader v-else-if="carregando" type="card" class="mt-4" />
  </v-container>
</template>
