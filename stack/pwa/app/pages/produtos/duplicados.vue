<script setup lang="ts">
import type { Duplicados, GrupoDuplicado } from '~/composables/useApi';

const api = useApi();
const { user } = useAuth();
const isAdmin = computed(() => user.value?.role === 'admin');

const CATALOGOS = [
  { value: 'BASE', label: 'Geral (Base)' },
  { value: 'TNP', label: 'TNP' },
  { value: 'LI', label: 'Lisboa' },
] as const;

const loja = ref<string>(isAdmin.value ? 'TNP' : (user.value?.loja ?? 'TNP'));
const semelhancaMinima = ref(75);
const dados = ref<Duplicados | null>(null);
const carregando = ref(false);
const erro = ref('');

const MOTIVOS = {
  codigo_barras: { label: 'Mesmo código de barras', cor: 'error' },
  codigo_interno: { label: 'Mesmo código interno', cor: 'warning' },
  nome: { label: 'Nome parecido', cor: 'info' },
  sem_base: { label: 'Sem vínculo com a Base', cor: 'grey' },
} as const;
const filtro = ref<string[]>(['codigo_barras', 'codigo_interno', 'nome']);

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.produtosDuplicados({
      ...(isAdmin.value ? { loja: loja.value } : {}),
      semelhancaMinima: semelhancaMinima.value,
    });
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar o diagnóstico.';
  } finally {
    carregando.value = false;
  }
}

onMounted(carregar);
watch([loja, semelhancaMinima], carregar);

const visiveis = computed(() => (dados.value?.grupos ?? []).filter((g) => filtro.value.includes(g.motivo)));

const flash = useFlash();
const mostrarFlash = computed({
  get: () => !!flash.value,
  set: (v: boolean) => { if (!v) flash.value = null; },
});

/**
 * Unificação: o admin escolhe qual LINHA sobrevive, não campo a campo — é
 * onde esse tipo de tela vira um formulário que ninguém termina.
 */
const unificarDialog = ref(false);
const grupoAlvo = ref<GrupoDuplicado | null>(null);
const vencedorId = ref<string | null>(null);
const fiscalConfirmado = ref(false);
const unificando = ref(false);

function abrirUnificar(g: GrupoDuplicado) {
  grupoAlvo.value = g;
  // ninguém vem pré-escolhido: a escolha precisa ser consciente
  vencedorId.value = null;
  fiscalConfirmado.value = false;
  unificarDialog.value = true;
}

const perdedores = computed(() =>
  (grupoAlvo.value?.produtos ?? []).filter((p) => p.id !== vencedorId.value));

const podeUnificar = computed(() =>
  !!vencedorId.value
  && perdedores.value.length === 1
  && (!grupoAlvo.value?.fiscalDiverge || fiscalConfirmado.value));

async function confirmarUnificacao() {
  if (!podeUnificar.value || !grupoAlvo.value) return;
  unificando.value = true;
  try {
    await api.unificarProdutos({
      vencedorProductId: vencedorId.value!,
      perdedorProductId: perdedores.value[0]!.id,
      fiscalConfirmado: fiscalConfirmado.value,
    });
    flash.value = { texto: 'Cadastros unificados. O perdedor foi aposentado, não apagado.', tipo: 'success' };
    unificarDialog.value = false;
    await carregar();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível unificar.',
      tipo: 'error',
    };
  } finally {
    unificando.value = false;
  }
}

const recusando = ref('');
/** "Não são o mesmo": tira o par da fila para sempre. */
async function recusar(g: GrupoDuplicado) {
  if (g.produtos.length !== 2) return;
  recusando.value = g.chave;
  try {
    await api.recusarDuplicidade({ produtoAId: g.produtos[0]!.id, produtoBId: g.produtos[1]!.id });
    flash.value = { texto: 'Registrado. Este par não será sugerido de novo.', tipo: 'success' };
    await carregar();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível registrar.',
      tipo: 'error',
    };
  } finally {
    recusando.value = '';
  }
}

const ligando = ref('');
/** Caso D2: pendura o produto da loja num produto da Base. */
async function ligar(productId: string, baseProductId: string) {
  ligando.value = productId;
  try {
    await api.ligarBase({ productId, baseProductId });
    flash.value = { texto: 'Produto ligado à Base. Custo e preço da loja não foram tocados.', tipo: 'success' };
    await carregar();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível ligar.',
      tipo: 'error',
    };
  } finally {
    ligando.value = '';
  }
}

/** Unificar só no que é INDISCUTÍVEL: mesmo código, mesma loja, exatamente 2. */
const podeUnificarGrupo = (g: GrupoDuplicado) =>
  isAdmin.value
  && (g.motivo === 'codigo_barras' || g.motivo === 'codigo_interno')
  && g.produtos.length === 2;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const rotuloCampo: Record<string, string> = {
  custo: 'Custo', vVendaPontual: 'V. Venda', ncm: 'NCM',
  cstPisCofins: 'CST', aliquotaSimples: 'Alíq. Simples', nome: 'Nome',
};
</script>

<template>
  <div>
    <div class="d-flex align-center mb-4">
      <v-btn icon="arrow_back" variant="text" to="/" />
      <h1 class="text-h6 font-weight-bold ml-2">Cadastros possivelmente duplicados</h1>
    </div>

    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <v-select
        v-if="isAdmin"
        v-model="loja"
        :items="CATALOGOS"
        item-title="label"
        item-value="value"
        label="Catálogo"
        variant="outlined"
        density="compact"
        hide-details
        style="max-width: 190px"
      />
      <div style="min-width: 240px">
        <div class="text-caption text-medium-emphasis">Piso de semelhança de nome: {{ semelhancaMinima }}%</div>
        <v-slider v-model="semelhancaMinima" :min="50" :max="100" :step="5" hide-details density="compact" />
      </div>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">Atualizar</v-btn>
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <div v-if="carregando && !dados" class="d-flex justify-center pa-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="dados">
      <!--
        Unificar só está liberado no caso INDISCUTÍVEL: mesmo código de barras,
        mesma loja, exatamente dois cadastros. Nome parecido é sugestão e ainda
        não tem botão — julgar semelhança é outra fatia.
      -->
      <v-alert type="info" variant="tonal" density="compact" class="mb-4">
        {{ num(dados.produtosAnalisados) }} produto(s) analisados no catálogo
        <strong>{{ dados.loja }}</strong>.
        <template v-if="isAdmin">
          Só é possível unificar quando o <strong>código de barras é o mesmo</strong> —
          os demais grupos são diagnóstico.
        </template>
        <template v-else>Esta tela apenas <strong>mostra</strong>: unificar é do administrador.</template>
      </v-alert>

      <v-row class="mb-1">
        <v-col cols="6" md="3">
          <v-card flat border rounded="lg" class="pa-3">
            <div class="text-caption text-medium-emphasis text-uppercase">Mesmo cód. barras</div>
            <div class="text-h6 font-weight-bold text-error">{{ num(dados.totais.codigoBarras) }}</div>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card flat border rounded="lg" class="pa-3">
            <div class="text-caption text-medium-emphasis text-uppercase">Mesmo cód. interno</div>
            <div class="text-h6 font-weight-bold">{{ num(dados.totais.codigoInterno) }}</div>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card flat border rounded="lg" class="pa-3">
            <div class="text-caption text-medium-emphasis text-uppercase">Nome parecido</div>
            <div class="text-h6 font-weight-bold">{{ num(dados.totais.nome) }}</div>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card flat border rounded="lg" class="pa-3">
            <div class="text-caption text-medium-emphasis text-uppercase">Sem base</div>
            <div class="text-h6 font-weight-bold">{{ num(dados.totais.semBase) }}</div>
          </v-card>
        </v-col>
      </v-row>

      <div class="text-body-2 mb-4">
        <strong>{{ brl(dados.faturamentoEnvolvido) }}</strong> em vendas dos últimos 90 dias passam por
        cadastros duplicados. A lista começa pelo que move mais dinheiro — não pelo que é mais parecido.
      </div>

      <v-chip-group v-model="filtro" multiple column class="mb-3">
        <v-chip v-for="(m, chave) in MOTIVOS" :key="chave" :value="chave" :color="m.cor" variant="tonal" filter size="small">
          {{ m.label }}
        </v-chip>
      </v-chip-group>

      <v-alert v-if="!visiveis.length" type="success" variant="tonal">
        Nenhum cadastro duplicado com os filtros atuais.
      </v-alert>

      <v-card v-for="(g, i) in visiveis" :key="`${g.motivo}-${g.chave}-${i}`" flat border rounded="lg" class="pa-4 mb-3">
        <div class="d-flex align-center flex-wrap ga-2 mb-3">
          <v-chip :color="MOTIVOS[g.motivo].cor" size="small" variant="tonal">{{ MOTIVOS[g.motivo].label }}</v-chip>
          <span v-if="g.semelhanca !== null" class="text-caption text-medium-emphasis">{{ g.semelhanca }}% parecidos</span>
          <span class="text-caption text-medium-emphasis text-truncate" style="max-width: 340px">{{ g.chave }}</span>
          <v-spacer />
          <span class="text-body-2 font-weight-bold">{{ brl(g.faturamento90d) }}</span>
          <span class="text-caption text-medium-emphasis">90 dias</span>
          <v-btn
            v-if="podeUnificarGrupo(g)"
            size="small"
            variant="tonal"
            color="primary"
            @click="abrirUnificar(g)"
          >Unificar</v-btn>
          <!--
            Nome parecido é SUGESTÃO. Sem o "não são o mesmo", o par volta toda
            semana e a tela perde a confiança de quem usa.
          -->
          <v-btn
            v-if="isAdmin && g.motivo === 'nome' && g.produtos.length === 2"
            size="small"
            variant="text"
            :loading="recusando === g.chave"
            @click="recusar(g)"
          >Não são o mesmo</v-btn>
        </div>

        <!--
          "os dados se mantêm já que são iguais" precisa ser CONFERIDO: se o
          custo ou a alíquota diferem, eles não eram iguais.
        -->
        <div v-if="g.camposDiferentes.length" class="mb-3">
          <span class="text-caption text-medium-emphasis">Diferem em:</span>
          <v-chip
            v-for="c in g.camposDiferentes"
            :key="c"
            size="x-small"
            :color="['ncm','cstPisCofins','aliquotaSimples'].includes(c) ? 'error' : 'warning'"
            variant="tonal"
            class="ml-1"
          >{{ rotuloCampo[c] ?? c }}</v-chip>
        </div>

        <v-alert v-if="g.fiscalDiverge" type="error" variant="tonal" density="compact" class="mb-3">
          O <strong>fiscal diverge</strong> entre estes cadastros. Unificar sem decidir qual vale
          poria imposto errado no cupom.
        </v-alert>

        <!-- Caso D2: ligar, não fundir. Não copia custo nem preço. -->
        <div v-if="g.motivo === 'sem_base' && isAdmin" class="mb-3">
          <div v-if="!g.sugestoesBase.length" class="text-caption text-medium-emphasis">
            Nenhum produto da Base parecido. Cadastre na Base e volte aqui.
          </div>
          <div v-for="s in g.sugestoesBase" :key="s.productId" class="d-flex align-center flex-wrap ga-2 mb-1">
            <v-chip size="x-small" :color="s.porCodigoBarras ? 'success' : 'info'" variant="tonal">
              {{ s.porCodigoBarras ? 'código de barras' : s.semelhanca + '%' }}
            </v-chip>
            <span class="text-body-2 text-truncate" style="max-width: 380px">{{ s.descricao || s.nome }}</span>
            <v-spacer />
            <v-btn
              size="small"
              variant="tonal"
              color="primary"
              :loading="ligando === g.produtos[0]!.id"
              @click="ligar(g.produtos[0]!.id, s.productId)"
            >Ligar à Base</v-btn>
          </div>
        </div>

        <div style="overflow-x: auto">
          <v-table density="compact">
            <thead>
              <tr>
                <th class="text-left">Produto</th>
                <th class="text-left">Cód. barras</th>
                <th class="text-left">Interno</th>
                <th class="text-right">Custo</th>
                <th class="text-right">V. Venda</th>
                <th class="text-left">NCM</th>
                <th class="text-left">CST</th>
                <th class="text-left">Base</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in g.produtos" :key="p.id">
                <td>
                  <NuxtLink :to="`/produtos/${p.id}`" class="text-primary">{{ p.descricao || p.nome }}</NuxtLink>
                </td>
                <td class="text-no-wrap">{{ p.codigoBarras || '—' }}</td>
                <td class="text-no-wrap">{{ p.codigoInterno || '—' }}</td>
                <td class="text-right">{{ p.custo == null ? '—' : brl(p.custo) }}</td>
                <td class="text-right">{{ p.vVendaPontual == null ? '—' : brl(p.vVendaPontual) }}</td>
                <td class="text-no-wrap">{{ p.ncm || '—' }}</td>
                <td class="text-no-wrap">{{ p.cstPisCofins || '—' }}</td>
                <td>{{ p.temBase ? 'sim' : 'não' }}</td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card>
    </template>

    <v-snackbar v-model="mostrarFlash" :color="flash?.tipo ?? 'success'" :timeout="flash?.tipo === 'success' ? 5000 : 9000" location="top">
      {{ flash?.texto }}
      <template #actions><v-btn variant="text" @click="mostrarFlash = false">Fechar</v-btn></template>
    </v-snackbar>

    <v-dialog v-model="unificarDialog" max-width="920" scrollable>
      <v-card v-if="grupoAlvo" rounded="lg">
        <v-card-title class="text-subtitle-1 font-weight-bold">Unificar cadastros</v-card-title>
        <v-card-text>
          <v-alert type="info" variant="tonal" density="compact" class="mb-4">
            Escolha <strong>qual cadastro sobrevive</strong>. O outro é
            <strong>aposentado, não apagado</strong>: some das listagens, mas continua no banco
            com um retrato completo, e os vínculos de venda passam para o vencedor.
          </v-alert>

          <v-alert v-if="grupoAlvo.fiscalDiverge" type="error" variant="tonal" density="compact" class="mb-4">
            <div class="mb-2">
              <strong>O fiscal diverge.</strong> Isso significa que estes cadastros
              <strong>não eram iguais</strong>. Ao unificar, passa a valer o NCM, CST e alíquota do vencedor.
            </div>
            <v-checkbox
              v-model="fiscalConfirmado"
              density="compact"
              hide-details
              label="Conferi e assumo o fiscal do cadastro vencedor"
            />
          </v-alert>

          <div style="overflow-x: auto">
            <v-table density="compact">
              <thead>
                <tr>
                  <th class="text-left">Sobrevive</th>
                  <th class="text-left">Produto</th>
                  <th class="text-left">Cód. barras</th>
                  <th class="text-left">Interno</th>
                  <th class="text-right">Custo</th>
                  <th class="text-right">V. Venda</th>
                  <th class="text-left">NCM</th>
                  <th class="text-left">CST</th>
                  <th class="text-right">90 dias</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in grupoAlvo.produtos" :key="p.id">
                  <td>
                    <v-radio-group v-model="vencedorId" hide-details density="compact">
                      <v-radio :value="p.id" />
                    </v-radio-group>
                  </td>
                  <td :class="grupoAlvo.camposDiferentes.includes('nome') ? 'text-error font-weight-bold' : ''">{{ p.descricao || p.nome }}</td>
                  <td class="text-no-wrap">{{ p.codigoBarras || '—' }}</td>
                  <td class="text-no-wrap">{{ p.codigoInterno || '—' }}</td>
                  <td class="text-right" :class="grupoAlvo.camposDiferentes.includes('custo') ? 'text-error font-weight-bold' : ''">{{ p.custo == null ? '—' : brl(p.custo) }}</td>
                  <td class="text-right" :class="grupoAlvo.camposDiferentes.includes('vVendaPontual') ? 'text-error font-weight-bold' : ''">{{ p.vVendaPontual == null ? '—' : brl(p.vVendaPontual) }}</td>
                  <td :class="grupoAlvo.camposDiferentes.includes('ncm') ? 'text-error font-weight-bold' : ''">{{ p.ncm || '—' }}</td>
                  <td :class="grupoAlvo.camposDiferentes.includes('cstPisCofins') ? 'text-error font-weight-bold' : ''">{{ p.cstPisCofins || '—' }}</td>
                  <td class="text-right">{{ brl(p.faturamento90d) }}</td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <div v-if="grupoAlvo.camposDiferentes.length" class="text-caption text-error mt-2">
            Em vermelho, os campos que <strong>diferem</strong>. "Os dados se mantêm porque são
            iguais" precisa ser conferido, não assumido.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="unificarDialog = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!podeUnificar" :loading="unificando" @click="confirmarUnificacao">
            Unificar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
