<script setup lang="ts">
import { VendasDatas } from '@pralis/shared';
import type { DeParaLista } from '~/composables/useApi';

const api = useApi();
const { user } = useAuth();
const flash = useFlash();
const isAdmin = computed(() => user.value?.role === 'admin');

const LOJAS = [
  { value: 'TNP', label: 'TNP' },
  { value: 'LI', label: 'Lisboa' },
] as const;

const hoje = new Date();
const loja = ref<'TNP' | 'LI'>(user.value?.loja === 'LI' ? 'LI' : 'TNP');
const inicio = ref(VendasDatas.dataLocalISO(VendasDatas.diasAntes(hoje, 29)));
const fim = ref(VendasDatas.dataLocalISO(hoje));

const dados = ref<DeParaLista | null>(null);
const carregando = ref(false);
const erro = ref('');
/** Produto escolhido por linha, antes de confirmar. Nada é salvo sozinho. */
const escolha = reactive<Record<string, string | null>>({});
const salvando = ref('');

const chave = (p: { produtoCodigo: string; produto: string }) => `${p.produtoCodigo}|${p.produto}`;

async function carregar() {
  carregando.value = true;
  erro.value = '';
  try {
    dados.value = await api.vendasDePara({
      ...(isAdmin.value ? { loja: loja.value } : {}),
      inicio: inicio.value,
      fim: fim.value,
    });
  } catch (e: unknown) {
    dados.value = null;
    erro.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar os produtos sem vínculo.';
  } finally {
    carregando.value = false;
  }
}

onMounted(carregar);
watch([loja, inicio, fim], carregar);

async function confirmar(pendente: DeParaLista['pendentes'][number]) {
  const productId = escolha[chave(pendente)];
  if (!productId) return;
  salvando.value = chave(pendente);
  try {
    await api.vincularDePara({
      loja: dados.value!.loja,
      produtoCodigo: pendente.produtoCodigo,
      produto: pendente.produto,
      productId,
    });
    flash.value = { texto: `“${pendente.produto}” vinculado ao cadastro`, tipo: 'success' };
    await carregar();
  } catch (e: unknown) {
    flash.value = {
      texto: (e as { data?: { message?: string } })?.data?.message || 'Não foi possível vincular.',
      tipo: 'error',
    };
  } finally {
    salvando.value = '';
  }
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

const mostrarFlash = computed({
  get: () => !!flash.value,
  set: (v: boolean) => { if (!v) flash.value = null; },
});
</script>

<template>
  <div>
    <v-snackbar v-model="mostrarFlash" :color="flash?.tipo ?? 'success'" :timeout="flash?.tipo === 'success' ? 4000 : 9000" location="top">
      {{ flash?.texto }}
      <template #actions><v-btn variant="text" @click="mostrarFlash = false">Fechar</v-btn></template>
    </v-snackbar>

    <div class="d-flex align-center mb-4">
      <v-btn icon="arrow_back" variant="text" to="/vendas" />
      <h1 class="text-h6 font-weight-bold ml-2">Produtos do PDV sem cadastro</h1>
    </div>

    <div class="d-flex align-center flex-wrap ga-3 mb-4">
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
      <v-text-field v-model="inicio" type="date" label="De" variant="outlined" density="compact" hide-details style="max-width: 190px" />
      <v-text-field v-model="fim" type="date" label="Até" variant="outlined" density="compact" hide-details style="max-width: 190px" />
      <v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">Atualizar</v-btn>
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <div v-if="carregando && !dados" class="d-flex justify-center pa-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="dados">
      <v-alert v-if="!dados.pendentes.length" type="success" variant="tonal">
        Todos os produtos vendidos no período estão ligados ao cadastro. A margem cobre 100% do faturamento.
      </v-alert>

      <template v-else>
        <v-alert type="info" variant="tonal" density="compact" class="mb-4">
          <strong>{{ num(dados.pendentes.length) }}</strong> produto(s) somando
          <strong>{{ brl(dados.faturamentoPendente) }}</strong> não têm custo no cadastro e ficam de fora da margem.
          A lista começa pelo que mais pesa. As sugestões são por semelhança de nome —
          <strong>confira antes de confirmar</strong>: vincular errado calcula margem com o custo de outro produto.
        </v-alert>

        <v-card v-for="p in dados.pendentes" :key="chave(p)" flat border rounded="lg" class="pa-4 mb-3">
          <div class="d-flex align-center flex-wrap ga-2 mb-3">
            <div style="min-width: 0">
              <div class="text-body-1 font-weight-bold text-truncate">{{ p.produto }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ p.produtoCodigo || 'sem código no PDV' }} · {{ num(p.quantidade) }} vendida(s)
              </div>
            </div>
            <v-spacer />
            <div class="text-body-1 font-weight-bold">{{ brl(p.faturamento) }}</div>
          </div>

          <div v-if="!p.sugestoes.length" class="text-caption text-medium-emphasis">
            Nenhum produto do cadastro tem nome parecido. Cadastre o produto na loja e volte aqui.
          </div>

          <template v-else>
            <v-radio-group v-model="escolha[chave(p)]" density="compact" hide-details class="mb-2">
              <v-radio v-for="s in p.sugestoes" :key="s.productId" :value="s.productId">
                <template #label>
                  <div>
                    <div class="text-body-2">
                      {{ s.descricao || s.nome }}
                      <v-chip size="x-small" variant="tonal" class="ml-1">{{ s.semelhanca }}%</v-chip>
                    </div>
                    <div class="text-caption text-medium-emphasis">
                      {{ s.codigoBarras || 'sem código de barras' }} ·
                      {{ s.custo == null ? 'sem custo cadastrado' : `custo ${brl(s.custo)}` }}
                    </div>
                  </div>
                </template>
              </v-radio>
            </v-radio-group>

            <v-btn
              size="small"
              color="primary"
              variant="flat"
              :disabled="!escolha[chave(p)]"
              :loading="salvando === chave(p)"
              @click="confirmar(p)"
            >
              Confirmar vínculo
            </v-btn>
          </template>
        </v-card>
      </template>
    </template>
  </div>
</template>
