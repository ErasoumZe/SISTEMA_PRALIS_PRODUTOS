<script setup lang="ts">
import type { EstadoReconciliacao, Reconciliacao } from '~/composables/useApi';

/**
 * Conferência banco x planilha. A tela é DE LEITURA: não há botão de corrigir,
 * porque o valor dela é dizer a verdade sobre a divergência — consertar é
 * decisão de quem lê, pelos caminhos que já existem.
 */
const api = useApi();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const dados = ref<Reconciliacao | null>(null);
const carregando = ref(false);
const erro = ref('');

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.produtosReconciliacao();
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar a conferência.';
  } finally {
    carregando.value = false;
  }
}

onMounted(() => { void carregar(); });

/**
 * Estado que não é `ok` NÃO é erro de tela: é a integração desligada, sem
 * credencial ou fora do ar. Cada um pede uma providência diferente, então cada
 * um tem sua frase — "erro ao carregar" mandaria o José procurar bug onde só
 * falta virar uma env.
 */
const AVISO: Record<Exclude<EstadoReconciliacao, 'ok'>, { cor: string; titulo: string }> = {
  desligado: { cor: 'info', titulo: 'Integração com a planilha desligada' },
  'sem-destino': { cor: 'warning', titulo: 'Falta configurar o destino' },
  'sem-credencial': { cor: 'warning', titulo: 'Falta a credencial do Google' },
  'sem-aba': { cor: 'error', titulo: 'Aba não encontrada' },
  'sem-coluna': { cor: 'error', titulo: 'A aba não tem as colunas de identidade' },
  falhou: { cor: 'error', titulo: 'O Google recusou a leitura' },
};
const aviso = computed(() => (dados.value && dados.value.estado !== 'ok'
  ? AVISO[dados.value.estado]
  : null));

const n = (v: number) => v.toLocaleString('pt-BR');

/** Um cartão por pergunta que o relatório responde. */
const cartoes = computed(() => {
  const r = dados.value?.resumo;
  if (!r) return [];
  return [
    { r: 'Produtos no banco (BASE)', v: r.produtosNoBanco, c: undefined },
    { r: 'Linhas com produto', v: r.linhasComProduto, c: undefined },
    { r: 'Sem linha na planilha', v: r.semLinhaNaPlanilha, c: r.semLinhaNaPlanilha ? 'error' : undefined },
    { r: 'Linhas órfãs', v: r.linhasOrfas, c: r.linhasOrfas ? 'error' : undefined },
    { r: 'Linhas sem ID', v: r.linhasSemId, c: r.linhasSemId ? 'warning' : undefined },
    { r: 'Nomes divergentes', v: r.nomeDivergente, c: r.nomeDivergente ? 'warning' : undefined },
  ];
});

const semDivergencia = computed(() => {
  const r = dados.value?.resumo;
  return !!r && r.semLinhaNaPlanilha + r.linhasOrfas + r.linhasSemId + r.nomeDivergente === 0;
});
</script>

<template>
  <div>
    <v-alert v-if="!isAdmin" type="warning" variant="tonal" class="mb-4">
      Esta tela é do administrador.
    </v-alert>

    <template v-else>
      <v-alert type="info" variant="tonal" density="compact" class="mb-4">
        Conferência somente leitura. Nada é gravado no banco nem na planilha.
      </v-alert>

      <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
      <div v-if="carregando" class="text-center py-8"><v-progress-circular indeterminate /></div>

      <template v-else-if="dados">
        <v-alert v-if="aviso" :type="aviso.cor as 'info' | 'warning' | 'error'" variant="tonal" class="mb-4">
          <div class="font-weight-bold">{{ aviso.titulo }}</div>
          <div class="text-body-2">{{ dados.mensagem }}</div>
        </v-alert>

        <template v-else>
          <!-- onde as colunas foram achadas AGORA: elas andam quando alguém insere coluna -->
          <div class="text-body-2 text-medium-emphasis mb-3">
            Aba <strong>{{ dados.aba }}</strong> ·
            ID na coluna <strong>{{ dados.colunaId }}</strong> ·
            nome na coluna <strong>{{ dados.colunaNome }}</strong>
            <v-btn
              size="small"
              variant="text"
              prepend-icon="refresh"
              class="ml-2"
              @click="carregar"
            >Conferir de novo</v-btn>
          </div>

          <div class="d-flex flex-wrap ga-3 mb-4">
            <v-card
              v-for="k in cartoes"
              :key="k.r"
              flat
              border
              rounded="lg"
              class="pa-3"
              style="min-width: 160px; flex: 1 1 160px"
            >
              <div class="text-caption text-medium-emphasis">{{ k.r }}</div>
              <div class="text-h5 font-weight-bold" :class="k.c ? `text-${k.c}` : ''">
                {{ n(k.v) }}
              </div>
            </v-card>
          </div>

          <v-alert v-if="semDivergencia" type="success" variant="tonal" class="mb-4">
            {{ dados.mensagem }}
          </v-alert>
          <v-alert v-if="dados.resumo.truncado" type="info" variant="tonal" density="compact" class="mb-4">
            As listas mostram no máximo {{ n(dados.resumo.limite) }} item(ns) cada.
            As contagens dos cartões continuam completas.
          </v-alert>

          <v-card v-if="dados.semLinhaNaPlanilha.length" flat border rounded="lg" class="pa-4 mb-3">
            <div class="text-body-1 font-weight-bold mb-1">Produtos do banco sem linha na planilha</div>
            <div class="text-caption text-medium-emphasis mb-3">
              O cadastro existe no Pralis e a planilha não sabe dele — é sincronização que não completou.
            </div>
            <div style="overflow-x: auto">
              <v-table density="compact">
                <thead>
                  <tr>
                    <th class="text-left">Produto</th>
                    <th class="text-left">Código</th>
                    <th class="text-left">Interno</th>
                    <th class="text-left">ID</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in dados.semLinhaNaPlanilha" :key="p.produtoId">
                    <td>{{ p.nome }}</td>
                    <td class="text-caption">{{ p.codigo }}</td>
                    <td class="text-caption">{{ p.codigoInterno || '—' }}</td>
                    <td class="text-caption">{{ p.produtoId }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </v-card>

          <v-card v-if="dados.linhasOrfas.length" flat border rounded="lg" class="pa-4 mb-3">
            <div class="text-body-1 font-weight-bold mb-1">Linhas órfãs na planilha</div>
            <div class="text-caption text-medium-emphasis mb-3">
              A linha tem ID, mas o produto não está mais no banco — foi excluído ou unificado.
            </div>
            <div style="overflow-x: auto">
              <v-table density="compact">
                <thead>
                  <tr>
                    <th class="text-left">Linha</th>
                    <th class="text-left">Produto na planilha</th>
                    <th class="text-left">ID</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="l in dados.linhasOrfas" :key="l.linha">
                    <td class="text-caption">{{ l.linha }}</td>
                    <td>{{ l.nome || '—' }}</td>
                    <td class="text-caption">{{ l.id }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </v-card>

          <v-card v-if="dados.nomeDivergente.length" flat border rounded="lg" class="pa-4 mb-3">
            <div class="text-body-1 font-weight-bold mb-1">Nomes diferentes nos dois lados</div>
            <div class="text-caption text-medium-emphasis mb-3">
              Mesmo produto, nome que não bate. Caixa, espaço duplo e caractere invisível não entram aqui.
            </div>
            <div style="overflow-x: auto">
              <v-table density="compact">
                <thead>
                  <tr>
                    <th class="text-left">Linha</th>
                    <th class="text-left">No banco</th>
                    <th class="text-left">Na planilha</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="d in dados.nomeDivergente" :key="d.produtoId">
                    <td class="text-caption">{{ d.linha }}</td>
                    <td>{{ d.nomeNoBanco }}</td>
                    <td class="text-error">{{ d.nomeNaPlanilha }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </v-card>

          <v-card v-if="dados.linhasSemId.length" flat border rounded="lg" class="pa-4 mb-3">
            <div class="text-body-1 font-weight-bold mb-1">Linhas sem ID</div>
            <div class="text-caption text-medium-emphasis mb-3">
              Têm produto e nenhum ID: não há como ligá-las a um cadastro do banco. Hoje é a
              situação de quase toda a aba — a coluna de ID foi criada depois das linhas.
            </div>
            <div style="overflow-x: auto">
              <v-table density="compact">
                <thead>
                  <tr>
                    <th class="text-left">Linha</th>
                    <th class="text-left">Produto na planilha</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="l in dados.linhasSemId" :key="l.linha">
                    <td class="text-caption">{{ l.linha }}</td>
                    <td>{{ l.nome }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </v-card>
        </template>
      </template>
    </template>
  </div>
</template>
