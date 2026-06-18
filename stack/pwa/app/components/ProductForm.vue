<script setup lang="ts">
import { ProductRules } from '@pralis/shared';
import type { ProductRequests } from '@pralis/shared';

const props = defineProps<{ productId?: string }>();
const api = useApi();

const MEDIDAS_BASE = ['UN', 'KG', 'G', 'LT', 'ML'];
const MEDIDAS_COMPRA = ['UN', 'KG', 'LT'];
const EMBALAGENS = ['UN', 'KG', 'LT', 'MIL', 'FD', 'PCT', 'CX', 'POTE', 'EMB', 'SACO', 'BAND'];
const UNIDADES_TR = ['UN', 'G', 'ML'];
const LOJAS = ['TNP', 'LI', 'HORA'];
const SETORES = [
  'LJ - CAIXAS', 'LJ - VITRINES', 'LJ - ESTOQUE  LOJA', 'LJ - TREINAMENTO',
  'PROD. - PANIFICAÇÃO', 'PROD. - CONFEITARIA', 'PROD. - ESTOQUE PRODUÇÃO',
];

const form = reactive({
  nome: '', quantidade: 0, medidaBase: 'KG', fotoUrl: '',
  marca: '', embalagem: '', cDe: 'DE', qtCad: 1, medidaCompra: '', grupo: '', codigoBarras: '',
  status: 'ativo' as 'ativo' | 'inativo', habilitarAjuda: false,
  tipo: 'revenda' as 'revenda' | 'transformacao',
  // revenda (uma loja)
  loja: 'TNP', custo: 0, margemPct: 0, auto: true, vVendaPontual: 0,
  estoqueMin: 0, estoqueMax: 0, setorEstoque: '',
  // transformação
  precisao: 'EXATOS', qtdTransf: 0, unidadeTransf: 'G', produtoReceituario: '', refReceituario: '',
  // promoção (revenda)
  promoTipo: 'nenhum' as 'nenhum' | 'valor' | 'desconto',
  promoValor: 0, promoDescontoPct: 0, promoHoraInicio: '', promoHoraFim: '',
  promoDias: [false, false, false, false, false, false, false] as boolean[],
  // fiscal
  ncm: '', cest: '', categoria: '', cstPisCofins: '',
  aliquotaCheia: 0, aliquotaFcp: 0, aliquotaPis: 0, aliquotaCofins: 0, reducaoIcms: 0, icms: 0,
});

const DIAS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

const saving = ref(false);
const uploadingFoto = ref(false);
const erro = ref('');

async function onFoto(files: File | File[] | null) {
  const file = Array.isArray(files) ? files[0] : files;
  if (!file) return;
  uploadingFoto.value = true;
  erro.value = '';
  try {
    form.fotoUrl = await api.uploadFoto(file);
  } catch (e: unknown) {
    erro.value = (e as { data?: { message?: string } })?.data?.message || 'Falha no upload da foto.';
  } finally {
    uploadingFoto.value = false;
  }
}

// ---- preview ao vivo (regras compartilhadas) ----
const descricao = computed(() => ProductRules.montarDescricao(form.nome, form.quantidade, form.medidaBase));
const vVenda = computed(() =>
  ProductRules.calcularVVenda({
    auto: form.auto,
    custo: Number(form.custo) || 0,
    qtCad: Number(form.qtCad) || 1,
    margemPontual: form.margemPct ? Number(form.margemPct) / 100 : null,
    margemGrupo: 0,
    vVendaPontual: Number(form.vVendaPontual) || 0,
    descricao: descricao.value,
  }),
);
const validacaoQtd = computed(() =>
  form.tipo === 'transformacao'
    ? ProductRules.montarValidacaoQtd(descricao.value, form.precisao, Number(form.qtdTransf) || 0, form.unidadeTransf)
    : '',
);

function buildFiscal() {
  const has =
    form.ncm || form.cest || form.categoria || form.cstPisCofins ||
    form.aliquotaCheia || form.aliquotaFcp || form.aliquotaPis ||
    form.aliquotaCofins || form.reducaoIcms || form.icms;
  if (!has) return null;
  return {
    ncm: form.ncm || null,
    cest: form.cest || null,
    categoria: form.categoria || null,
    cstPisCofins: form.cstPisCofins || null,
    aliquotaCheia: Number(form.aliquotaCheia) || null,
    aliquotaFcp: Number(form.aliquotaFcp) || null,
    aliquotaPis: Number(form.aliquotaPis) || null,
    aliquotaCofins: Number(form.aliquotaCofins) || null,
    reducaoIcms: Number(form.reducaoIcms) || null,
    icms: Number(form.icms) || null,
  };
}

function buildPromocoes() {
  if (form.promoTipo === 'nenhum') return [];
  const temDia = form.promoDias.some(Boolean);
  return [{
    tipo: form.promoTipo,
    valor: form.promoTipo === 'valor' ? Number(form.promoValor) || null : null,
    descontoPct: form.promoTipo === 'desconto' ? Number(form.promoDescontoPct) / 100 : null,
    horaInicio: form.promoHoraInicio || null,
    horaFim: form.promoHoraFim || null,
    dias: temDia ? [...form.promoDias] : [true, true, true, true, true, true, true],
    descontoAte: null,
  }];
}

function buildPayload(): ProductRequests.CreateProductRequest {
  const base = {
    nome: form.nome,
    quantidade: Number(form.quantidade) || 0,
    medidaBase: form.medidaBase as ProductRequests.CreateProductRequest['medidaBase'],
    codigoBarras: form.codigoBarras || null,
    marca: form.marca || null,
    embalagem: (form.embalagem || null) as ProductRequests.CreateProductRequest['embalagem'],
    cDe: (form.cDe || null) as ProductRequests.CreateProductRequest['cDe'],
    qtCad: Number(form.qtCad) || 1,
    medidaCompra: (form.medidaCompra || null) as ProductRequests.CreateProductRequest['medidaCompra'],
    codigoInterno: null,
    fotoUrl: form.fotoUrl || null,
    grupo: form.grupo || null,
    tipo: form.tipo,
    status: form.status,
    habilitarAjuda: form.habilitarAjuda,
  };

  if (form.tipo === 'revenda') {
    return {
      ...base,
      lojas: [{
        loja: form.loja as 'TNP' | 'LI' | 'HORA',
        estoqueMin: Number(form.estoqueMin) || null,
        estoqueMax: Number(form.estoqueMax) || null,
        setorEstoque: form.setorEstoque || null,
        custo: Number(form.custo) || null,
        margemPontual: form.margemPct ? Number(form.margemPct) / 100 : null,
        vVendaPontual: Number(form.vVendaPontual) || null,
        auto: form.auto,
        localVenda1: null,
        localVenda2: null,
        promocoes: buildPromocoes(),
      }],
      transformacao: null,
      fiscal: buildFiscal(),
    };
  }

  return {
    ...base,
    lojas: [],
    transformacao: {
      precisao: form.precisao as 'EXATOS' | 'APROXIMADOS',
      qtd: Number(form.qtdTransf) || 0,
      unidade: form.unidadeTransf as 'UN' | 'G' | 'ML',
      produtoReceituario: form.produtoReceituario || null,
      refReceituario: form.refReceituario || null,
    },
    fiscal: buildFiscal(),
  };
}

async function salvar() {
  if (!form.nome.trim()) { erro.value = 'Informe o nome do produto.'; return; }
  saving.value = true;
  erro.value = '';
  try {
    if (props.productId) await api.updateProduct(props.productId, buildPayload());
    else await api.createProduct(buildPayload());
    await navigateTo('/');
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message;
    erro.value = msg || 'Erro ao salvar. Confira os campos.';
  } finally {
    saving.value = false;
  }
}

// ---- carregar para edição ----
onMounted(async () => {
  if (!props.productId) return;
  try {
    const p = await api.getProduct(props.productId);
    Object.assign(form, {
      nome: p.nome, quantidade: p.quantidade, medidaBase: p.medidaBase,
      marca: p.marca ?? '', embalagem: p.embalagem ?? '', cDe: p.cDe ?? 'DE',
      qtCad: p.qtCad, medidaCompra: p.medidaCompra ?? '', grupo: p.grupo ?? '', fotoUrl: p.fotoUrl ?? '',
      codigoBarras: p.codigoBarras ?? '', status: p.status, habilitarAjuda: p.habilitarAjuda, tipo: p.tipo,
    });
    const l = p.lojas?.[0];
    if (l) Object.assign(form, {
      loja: l.loja, custo: l.custo ?? 0, margemPct: l.margemPontual ? l.margemPontual * 100 : 0,
      auto: l.auto, vVendaPontual: l.vVendaPontual ?? 0,
      estoqueMin: l.estoqueMin ?? 0, estoqueMax: l.estoqueMax ?? 0, setorEstoque: l.setorEstoque ?? '',
    });
    if (p.transformacao) Object.assign(form, {
      precisao: p.transformacao.precisao, qtdTransf: p.transformacao.qtd, unidadeTransf: p.transformacao.unidade,
      produtoReceituario: p.transformacao.produtoReceituario ?? '', refReceituario: p.transformacao.refReceituario ?? '',
    });
    if (p.fiscal) Object.assign(form, {
      ncm: p.fiscal.ncm ?? '', cest: p.fiscal.cest ?? '', categoria: p.fiscal.categoria ?? '', cstPisCofins: p.fiscal.cstPisCofins ?? '',
      aliquotaCheia: p.fiscal.aliquotaCheia ?? 0, aliquotaFcp: p.fiscal.aliquotaFcp ?? 0,
      aliquotaPis: p.fiscal.aliquotaPis ?? 0, aliquotaCofins: p.fiscal.aliquotaCofins ?? 0,
      reducaoIcms: p.fiscal.reducaoIcms ?? 0, icms: p.fiscal.icms ?? 0,
    });
    const promo = l?.promocoes?.[0];
    if (promo) Object.assign(form, {
      promoTipo: promo.tipo, promoValor: promo.valor ?? 0,
      promoDescontoPct: promo.descontoPct ? promo.descontoPct * 100 : 0,
      promoHoraInicio: promo.horaInicio ?? '', promoHoraFim: promo.horaFim ?? '',
      promoDias: promo.dias ?? [false, false, false, false, false, false, false],
    });
  } catch {
    erro.value = 'Não foi possível carregar o produto.';
  }
});
</script>

<template>
  <div style="max-width: 760px; margin: 0 auto">
    <div class="d-flex align-center mb-4">
      <v-btn icon="mdi-arrow-left" variant="text" to="/" />
      <h1 class="text-h5 font-weight-bold ml-2">{{ productId ? 'Editar produto' : 'Novo produto' }}</h1>
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <!-- CADASTRO INICIAL -->
    <v-card flat border rounded="lg" class="mb-4">
      <v-card-title class="text-subtitle-1 font-weight-bold bg-grey-lighten-4">CADASTRO INICIAL</v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col cols="12" sm="6">
            <v-select v-model="form.status" :items="['ativo', 'inativo']" label="Status" variant="outlined" density="comfortable" />
          </v-col>
          <v-col cols="12" sm="6">
            <v-switch v-model="form.habilitarAjuda" label="Habilitar ajuda" color="primary" inset hide-details />
          </v-col>
          <v-col cols="12">
            <v-text-field v-model="form.nome" label="Nome do produto *" variant="outlined" density="comfortable" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="form.quantidade" type="number" label="Gramatura" variant="outlined" density="comfortable" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-select v-model="form.medidaBase" :items="MEDIDAS_BASE" label="Medida base" variant="outlined" density="comfortable" />
          </v-col>
          <v-col cols="12" sm="4">
            <v-text-field v-model="form.marca" label="Marca" variant="outlined" density="comfortable" />
          </v-col>
          <v-col cols="12">
            <v-text-field :model-value="descricao" label="Descrição (automática)" variant="outlined" density="comfortable" readonly bg-color="grey-lighten-4" />
          </v-col>
          <v-col cols="12" sm="8">
            <v-file-input
              label="Foto do produto"
              accept="image/*"
              prepend-icon="mdi-camera"
              variant="outlined"
              density="comfortable"
              :loading="uploadingFoto"
              hide-details
              @update:model-value="onFoto"
            />
          </v-col>
          <v-col cols="12" sm="4" class="d-flex align-center">
            <v-img v-if="form.fotoUrl" :src="form.fotoUrl" max-height="80" max-width="120" class="rounded border" />
            <span v-else class="text-caption text-medium-emphasis">Sem foto</span>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- CADASTRO GERAL -->
    <v-card flat border rounded="lg" class="mb-4">
      <v-card-title class="text-subtitle-1 font-weight-bold bg-grey-lighten-4">CADASTRO GERAL</v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.codigoBarras" label="Código de barras" variant="outlined" density="comfortable" />
          </v-col>
          <v-col cols="12" sm="6">
            <v-select v-model="form.embalagem" :items="EMBALAGENS" label="Embalagem" variant="outlined" density="comfortable" clearable />
          </v-col>
          <v-col cols="6" sm="3">
            <v-select v-model="form.cDe" :items="['C/', 'DE']" label="C/DE" variant="outlined" density="comfortable" />
          </v-col>
          <v-col cols="6" sm="3">
            <v-text-field v-model.number="form.qtCad" type="number" label="Qt. embalagem" variant="outlined" density="comfortable" />
          </v-col>
          <v-col cols="12" sm="6">
            <v-select v-model="form.medidaCompra" :items="MEDIDAS_COMPRA" label="Medida de compra" variant="outlined" density="comfortable" clearable />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- DESTINO -->
    <v-card flat border rounded="lg" class="mb-4">
      <v-card-title class="text-subtitle-1 font-weight-bold bg-grey-lighten-4">DESTINO DO PRODUTO</v-card-title>
      <v-card-text>
        <v-btn-toggle v-model="form.tipo" mandatory color="primary" divided class="mb-4">
          <v-btn value="revenda">Revenda</v-btn>
          <v-btn value="transformacao">Transformação</v-btn>
        </v-btn-toggle>

        <!-- REVENDA -->
        <template v-if="form.tipo === 'revenda'">
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-select v-model="form.loja" :items="LOJAS" label="Loja" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select v-model="form.setorEstoque" :items="SETORES" label="Setor de estoque" variant="outlined" density="comfortable" clearable />
            </v-col>
            <v-col cols="6" sm="3">
              <v-text-field v-model.number="form.estoqueMin" type="number" label="Estoque mín." variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="6" sm="3">
              <v-text-field v-model.number="form.estoqueMax" type="number" label="Estoque máx." variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="6" sm="3">
              <v-text-field v-model.number="form.custo" type="number" label="Custo (R$)" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="6" sm="3">
              <v-text-field v-model.number="form.margemPct" type="number" label="Margem %" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-switch v-model="form.auto" label="Calcular venda automático" color="primary" inset hide-details />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model.number="form.vVendaPontual" type="number" label="V. Venda pontual (R$)" variant="outlined" density="comfortable" :disabled="form.auto" />
            </v-col>
            <v-col cols="12">
              <v-text-field :model-value="`R$ ${vVenda.toFixed(2).replace('.', ',')}`" label="V. Venda (calculado)" variant="outlined" density="comfortable" readonly bg-color="purple-lighten-5" />
            </v-col>

            <v-col cols="12"><v-divider class="my-1" /><div class="text-subtitle-2 font-weight-bold mt-1">PROMOÇÃO</div></v-col>
            <v-col cols="12">
              <v-btn-toggle v-model="form.promoTipo" mandatory color="primary" divided density="comfortable">
                <v-btn value="nenhum">Sem promoção</v-btn>
                <v-btn value="valor">Valor fixo</v-btn>
                <v-btn value="desconto">Desconto %</v-btn>
              </v-btn-toggle>
            </v-col>
            <template v-if="form.promoTipo !== 'nenhum'">
              <v-col v-if="form.promoTipo === 'valor'" cols="6" sm="4">
                <v-text-field v-model.number="form.promoValor" type="number" label="Valor promo (R$)" variant="outlined" density="comfortable" />
              </v-col>
              <v-col v-if="form.promoTipo === 'desconto'" cols="6" sm="4">
                <v-text-field v-model.number="form.promoDescontoPct" type="number" label="Desconto %" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="6" sm="4"><v-text-field v-model="form.promoHoraInicio" type="time" label="Início" variant="outlined" density="comfortable" /></v-col>
              <v-col cols="6" sm="4"><v-text-field v-model="form.promoHoraFim" type="time" label="Término" variant="outlined" density="comfortable" /></v-col>
              <v-col cols="12">
                <div class="text-caption text-medium-emphasis mb-1">Dias da semana</div>
                <div class="d-flex flex-wrap ga-3">
                  <v-checkbox v-for="(d, i) in DIAS" :key="i" v-model="form.promoDias[i]" :label="d" density="compact" hide-details color="primary" />
                </div>
              </v-col>
            </template>
          </v-row>
        </template>

        <!-- TRANSFORMAÇÃO -->
        <template v-else>
          <v-row dense>
            <v-col cols="6" sm="4">
              <v-select v-model="form.precisao" :items="['EXATOS', 'APROXIMADOS']" label="Precisão" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="6" sm="4">
              <v-text-field v-model.number="form.qtdTransf" type="number" label="Quantidade" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" sm="4">
              <v-select v-model="form.unidadeTransf" :items="UNIDADES_TR" label="Unidade" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="form.produtoReceituario" label="Produto receituário" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="form.refReceituario" label="Ref. receituário" variant="outlined" density="comfortable" />
            </v-col>
            <v-col cols="12">
              <v-text-field :model-value="validacaoQtd" label="Validação de quantidade (automática)" variant="outlined" density="comfortable" readonly bg-color="grey-lighten-4" />
            </v-col>
          </v-row>
        </template>
      </v-card-text>
    </v-card>

    <!-- FISCAL -->
    <v-card flat border rounded="lg" class="mb-4">
      <v-card-title class="text-subtitle-1 font-weight-bold bg-grey-lighten-4">FISCAL</v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col cols="12" sm="6"><v-text-field v-model="form.ncm" label="NCM" variant="outlined" density="comfortable" /></v-col>
          <v-col cols="12" sm="6"><v-text-field v-model="form.cest" label="Código CEST" variant="outlined" density="comfortable" /></v-col>
          <v-col cols="12" sm="6"><v-text-field v-model="form.categoria" label="Categoria" variant="outlined" density="comfortable" /></v-col>
          <v-col cols="12" sm="6"><v-text-field v-model="form.cstPisCofins" label="CST PIS/COFINS" variant="outlined" density="comfortable" /></v-col>
          <v-col cols="6" sm="4"><v-text-field v-model.number="form.aliquotaCheia" type="number" label="Alíquota cheia %" variant="outlined" density="comfortable" /></v-col>
          <v-col cols="6" sm="4"><v-text-field v-model.number="form.aliquotaFcp" type="number" label="Alíquota FCP %" variant="outlined" density="comfortable" /></v-col>
          <v-col cols="6" sm="4"><v-text-field v-model.number="form.icms" type="number" label="ICMS %" variant="outlined" density="comfortable" /></v-col>
          <v-col cols="6" sm="4"><v-text-field v-model.number="form.aliquotaPis" type="number" label="Alíquota PIS %" variant="outlined" density="comfortable" /></v-col>
          <v-col cols="6" sm="4"><v-text-field v-model.number="form.aliquotaCofins" type="number" label="Alíquota COFINS %" variant="outlined" density="comfortable" /></v-col>
          <v-col cols="6" sm="4"><v-text-field v-model.number="form.reducaoIcms" type="number" label="Redução ICMS %" variant="outlined" density="comfortable" /></v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <div class="d-flex justify-end ga-2">
      <v-btn variant="text" to="/">Cancelar</v-btn>
      <v-btn color="primary" :loading="saving" prepend-icon="mdi-content-save" @click="salvar">Salvar produto</v-btn>
    </div>
  </div>
</template>
