<script setup lang="ts">
import { VendasDatas } from '@pralis/shared';
import type { VendasReport } from '~/composables/useApi';

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
const inicio = ref(iso(VendasDatas.diasAntes(hoje, 29)));
const fim = ref(iso(hoje));

const dados = ref<VendasReport | null>(null);
const carregando = ref(false);
const erro = ref('');

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

onMounted(carregar);
watch([loja, inicio, fim], carregar);

const semMovimento = computed(() =>
  !!dados.value && dados.value.resumo.faturamento === 0 && dados.value.resumo.numeroVendas === 0);

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const dia = (d: string) => {
  const [a, m, x] = d.split('-');
  return `${x}/${m}/${a}`;
};
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const resumoCards = computed(() => {
  const r = dados.value?.resumo;
  if (!r) return [];
  // A origem fica escrita no card: faturamento e quantidade vêm das VENDAS por
  // produto; número de vendas e ticket vêm do FECHAMENTO de caixa. São duas
  // fontes e podem divergir — sem dizer isso, o usuário lê como erro de conta.
  return [
    { label: 'Faturamento', origem: 'vendas por produto', valor: brl(r.faturamento), icon: 'payments', cor: '#6515DD' },
    { label: 'Quantidade vendida', origem: 'vendas por produto', valor: num(r.quantidade), icon: 'inventory_2', cor: '#3B82F6' },
    { label: 'Nº de vendas', origem: 'fechamento de caixa', valor: num(r.numeroVendas), icon: 'receipt_long', cor: '#35128C' },
    { label: 'Ticket médio', origem: 'fechamento de caixa', valor: brl(r.ticketMedio), icon: 'trending_up', cor: '#34A853' },
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

/** Só mostra a coluna que teve movimento — 13 colunas zeradas é ruído. */
const colunasComMovimento = computed(() => {
  const linhas = dados.value?.pagamentos ?? [];
  return COLUNAS_PAGAMENTO.filter((c) => linhas.some((l) => Number(l[c.chave]) !== 0));
});

const corClasse = { A: 'success', B: 'warning', C: 'grey' } as const;

/**
 * A cor da cobertura é o aviso: abaixo de 80% o número de margem já não
 * representa o negócio, e quem lê precisa perceber isso sem ler o rodapé.
 */
const corCobertura = computed(() => {
  const c = dados.value?.margem.coberturaPercentual ?? 0;
  return c >= 80 ? 'success' : c >= 50 ? 'warning' : 'error';
});
</script>

<template>
  <div>
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
      <v-btn variant="tonal" prepend-icon="refresh" :loading="carregando" @click="carregar">Atualizar</v-btn>
    </div>

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

      <v-row class="mb-1">
        <v-col v-for="c in resumoCards" :key="c.label" cols="12" sm="6" md="3">
          <v-card flat border rounded="lg" class="pa-4 h-100">
            <div class="d-flex align-center ga-3">
              <v-avatar :color="c.cor" size="46" rounded="lg" variant="flat">
                <v-icon color="white">{{ c.icon }}</v-icon>
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

      <div class="text-caption text-medium-emphasis mb-4">
        O faturamento sai das vendas por produto e o número de vendas sai do fechamento
        de caixa. São registros diferentes do PDV, então os totais podem não bater:
        o fechamento inclui crediário, sobra/perda e outros lançamentos que não são venda de produto.
      </div>

      <v-alert v-if="semMovimento" type="info" variant="tonal" class="mb-4">
        Nenhuma venda registrada nesse período para esta loja.
      </v-alert>

      <template v-else>
        <v-row>
          <v-col cols="12" md="6">
            <v-card flat border rounded="lg" class="pa-4 h-100">
              <div class="text-subtitle-1 font-weight-bold mb-3">Mais vendidos</div>
              <div v-for="p in dados.ranking.maisVendidos" :key="`m-${p.produtoCodigo}-${p.produto}`" class="d-flex align-center ga-3 mb-2">
                <div class="flex-grow-1" style="min-width: 0">
                  <div class="text-body-2 text-truncate">{{ p.produto }}</div>
                  <div class="text-caption text-medium-emphasis">{{ p.produtoCodigo || 'sem código' }}</div>
                </div>
                <div class="text-right">
                  <div class="text-body-2 font-weight-bold">{{ num(p.quantidade) }}</div>
                  <div class="text-caption text-medium-emphasis">{{ brl(p.faturamento) }}</div>
                </div>
              </div>
            </v-card>
          </v-col>

          <v-col cols="12" md="6">
            <v-card flat border rounded="lg" class="pa-4 h-100">
              <div class="text-subtitle-1 font-weight-bold mb-1">Menos vendidos</div>
              <div class="text-caption text-medium-emphasis mb-3">Entre os que tiveram alguma venda no período.</div>
              <div v-for="p in dados.ranking.menosVendidos" :key="`n-${p.produtoCodigo}-${p.produto}`" class="d-flex align-center ga-3 mb-2">
                <div class="flex-grow-1" style="min-width: 0">
                  <div class="text-body-2 text-truncate">{{ p.produto }}</div>
                  <div class="text-caption text-medium-emphasis">{{ p.produtoCodigo || 'sem código' }}</div>
                </div>
                <div class="text-right">
                  <div class="text-body-2 font-weight-bold">{{ num(p.quantidade) }}</div>
                  <div class="text-caption text-medium-emphasis">{{ brl(p.faturamento) }}</div>
                </div>
              </div>
            </v-card>
          </v-col>
        </v-row>

        <v-card flat border rounded="lg" class="pa-4 mt-4">
          <div class="d-flex align-center flex-wrap ga-2 mb-1">
            <div class="text-subtitle-1 font-weight-bold">Margem e lucro</div>
            <v-spacer />
            <v-btn
              size="small"
              variant="tonal"
              :color="dados.margem.produtosSemVinculo ? 'warning' : undefined"
              to="/vendas/de-para"
            >
              Resolver produtos sem custo
              <template v-if="dados.margem.produtosSemVinculo">({{ num(dados.margem.produtosSemVinculo) }})</template>
            </v-btn>
          </div>

          <!--
            A cobertura vem ANTES do lucro de propósito. Margem calculada sobre
            metade do faturamento, apresentada como total, leva a decisão errada
            de preço — o pão sem custo cadastrado se esconde atrás da Coca-Cola.
          -->
          <div class="d-flex align-center ga-2 mb-1 mt-2">
            <span class="text-body-2">Calculada sobre</span>
            <strong :class="`text-${corCobertura}`">{{ pct(dados.margem.coberturaPercentual) }}</strong>
            <span class="text-body-2">do faturamento</span>
          </div>
          <v-progress-linear
            :model-value="dados.margem.coberturaPercentual"
            :color="corCobertura"
            height="8"
            rounded
            class="mb-3"
          />
          <div class="text-caption text-medium-emphasis mb-4">
            {{ brl(dados.margem.faturamentoSemCusto) }} em vendas ainda não têm custo cadastrado
            <template v-if="dados.margem.produtosSemVinculo">
              ({{ num(dados.margem.produtosSemVinculo) }} produto(s) sem vínculo)
            </template>.
          </div>

          <v-row dense>
            <v-col cols="12" sm="4">
              <div class="text-caption text-medium-emphasis text-uppercase">Custo</div>
              <div class="text-h6 font-weight-bold">{{ brl(dados.margem.custoTotal) }}</div>
            </v-col>
            <v-col cols="12" sm="4">
              <div class="text-caption text-medium-emphasis text-uppercase">Lucro bruto</div>
              <div class="text-h6 font-weight-bold" :class="dados.margem.lucroBruto < 0 ? 'text-error' : 'text-success'">
                {{ brl(dados.margem.lucroBruto) }}
              </div>
            </v-col>
            <v-col cols="12" sm="4">
              <div class="text-caption text-medium-emphasis text-uppercase">Margem</div>
              <div class="text-h6 font-weight-bold" :class="dados.margem.margemPercentual < 0 ? 'text-error' : ''">
                {{ pct(dados.margem.margemPercentual) }}
              </div>
            </v-col>
          </v-row>
        </v-card>

        <v-card flat border rounded="lg" class="pa-4 mt-4">
          <div class="text-subtitle-1 font-weight-bold mb-1">Curva ABC</div>
          <div class="text-caption text-medium-emphasis mb-3">
            A = os produtos que somam os primeiros 80% do faturamento; B até 95%; C o restante.
          </div>
          <div v-for="c in dados.curvaAbc" :key="c.classe" class="mb-3">
            <div class="d-flex align-center ga-2 mb-1">
              <v-chip :color="corClasse[c.classe]" size="small" variant="tonal" class="font-weight-bold">{{ c.classe }}</v-chip>
              <span class="text-body-2">{{ num(c.produtos) }} produto(s)</span>
              <v-spacer />
              <span class="text-body-2 font-weight-bold">{{ brl(c.faturamento) }}</span>
              <span class="text-caption text-medium-emphasis">{{ pct(c.percentual) }}</span>
            </div>
            <v-progress-linear :model-value="c.percentual" :color="corClasse[c.classe]" height="6" rounded />
          </div>
        </v-card>

        <v-card flat border rounded="lg" class="pa-4 mt-4">
          <div class="text-subtitle-1 font-weight-bold mb-3">Formas de pagamento por dia</div>
          <div v-if="!dados.pagamentos.length" class="text-caption text-medium-emphasis">
            Nenhum fechamento de caixa importado nesse período.
          </div>
          <!-- tabela larga: rola dentro do card, nunca empurra a página -->
          <div v-else style="overflow-x: auto">
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
        </v-card>
      </template>
    </template>
  </div>
</template>
