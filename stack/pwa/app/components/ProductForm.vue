<script setup lang="ts">
import { ProductRules, ProductRequests as Requests, VendasGerentes } from '@pralis/shared';
import type { ProductRequests } from '@pralis/shared';
import type { FiscalClassification, GroupTaxRule } from '~/composables/useApi';
import { aplicarFundoPralisComIa } from '~/composables/useProductPhotoAi';

const props = defineProps<{ productId?: string }>();
const api = useApi();
const flash = useFlash();
const { user } = useAuth();
// O bloco fiscal é derivado do grupo e tem consequência tributária: a API só
// aceita alteração manual vinda do admin (403 ONLY_ADMIN_FISCAL). A tela deixa
// os campos em leitura para o colaborador não descobrir isso por erro.
const isAdmin = computed(() => user.value?.role === 'admin');

const MEDIDAS_BASE = ['UN', 'KG', 'G', 'LT', 'ML'];
const MEDIDAS_COMPRA = ['UN', 'KG', 'LT'];
const EMBALAGENS = ['UN', 'KG', 'LT', 'MIL', 'FD', 'PCT', 'CX', 'POTE', 'EMB', 'SACO', 'BAND'];
const UNIDADES_TR = ['UN', 'G', 'ML'];
// Confirmado com o consultor Criare para o cadastro usado na TNP: tecla 000.
// No produto/API o valor e numerico; o TXT posicional completa as tres casas.
const TECLA_BALANCA_FIXA = 0;
const teclaBalancaExibicao = String(TECLA_BALANCA_FIXA).padStart(3, '0');
const SETORES = [
  'LJ - CAIXAS', 'LJ - VITRINES', 'LJ - ESTOQUE  LOJA', 'LJ - TREINAMENTO',
  'PROD. - PANIFICAÇÃO', 'PROD. - CONFEITARIA', 'PROD. - ESTOQUE PRODUÇÃO',
];
const AREAS_VENDA_TNP = VendasGerentes.AREAS_TNP.map((value) => ({ title: VendasGerentes.NOMES_AREAS_TNP[value], value }));

const form = reactive({
  nome: '', quantidade: 0, medidaBase: 'KG', fotoUrl: '',
  // Cadastro novo começa em "Não"; quem envia um pesável escolhe "Sim".
  pesavel: 'N' as 'S' | 'N' | null,
  teclaBalanca: null as number | null, validadeBalanca: null as number | null,
  marca: '', embalagem: '', cDe: 'DE', qtCad: 1, medidaCompra: '', compraAproximada: false,
  grupo: '', codigoBarras: '', codigoInterno: '',
  status: 'ativo' as 'ativo' | 'inativo', habilitarAjuda: false,
  tipo: 'revenda' as 'revenda' | 'transformacao',
  // comercial (revenda) — a loja vem do usuário logado
  custo: 0, margemPct: null as number | null, auto: true, vVendaPontual: 0,
  estoqueMin: 0, estoqueMax: 0, setorEstoque: '', localVenda1: '', localVenda2: '',
  setorVenda1: '', setorVenda2: '',
  areaVenda: null as VendasGerentes.AreaTnp | null,
  // transformação
  precisao: 'EXATOS', qtdTransf: 0, unidadeTransf: 'G', produtoReceituario: '', refReceituario: '',
  // promoção (revenda)
  promoTipo: 'nenhum' as 'nenhum' | 'valor' | 'desconto',
  promoValor: 0, promoDescontoPct: 0, promoHoraInicio: '', promoHoraFim: '',
  promoDias: [false, false, false, false, false, false, false] as boolean[],
  // fiscal
  ncm: '', cest: '', categoria: '', cstPisCofins: '',
  // estado fiscal: so leitura, vem do servidor e nunca e enviado de volta
  estadoFiscal: '', motivoFiscal: '',
  aliquotaCheia: 0, aliquotaFcp: 0, aliquotaPis: 0, aliquotaCofins: 0, reducaoIcms: 0, icms: 0,
  tributacaoSimples: '', aliquotaSimples: 0, icmsRe: 0, baseFiscal: '',
  codigoFiscal: '', produtoFiscal: '', cstReforma: '', cClassTrib: '',
  aliquotaIbs: 0, aliquotaCbs: 0, origemFiscal: '' as '' | 'produto' | 'plu_balanca' | 'grupo',
});

/**
 * Herança BASE -> loja. A comparação é entre o produto SALVO e o produto da
 * BASE — é o que o backend usa para decidir se o campo ainda segue a base.
 * Mesma lista de CAMPOS_HERDADOS do ProductService; promoções ficam de fora
 * porque são da loja por definição.
 */
const CAMPOS_HERANCA: Array<{ campo: string; label: string }> = [
  { campo: 'nome', label: 'Nome' },
  { campo: 'quantidade', label: 'Quantidade' },
  { campo: 'medidaBase', label: 'Medida base' },
  { campo: 'pesavel', label: 'Vai para balança' },
  { campo: 'teclaBalanca', label: 'Tecla da balança' },
  { campo: 'validadeBalanca', label: 'Validade da balança' },
  { campo: 'codigoBarras', label: 'Código de barras' },
  { campo: 'marca', label: 'Marca' },
  { campo: 'embalagem', label: 'Embalagem' },
  { campo: 'cDe', label: 'C/DE' },
  { campo: 'qtCad', label: 'Qt. cadastro' },
  { campo: 'medidaCompra', label: 'Medida de compra' },
  { campo: 'codigoInterno', label: 'Código interno' },
  { campo: 'fotoUrl', label: 'Foto' },
  { campo: 'grupo', label: 'Grupo' },
  { campo: 'tipo', label: 'Tipo' },
  { campo: 'habilitarAjuda', label: 'Habilitar ajuda' },
];

/**
 * Validação viva do estoque, reusando a MESMA função do contrato compartilhado.
 *
 * Reusar em vez de reescrever é o ponto: uma segunda cópia da regra aqui
 * divergiria da do servidor no primeiro ajuste, e a tela passaria a aceitar o
 * que a API recusa — ou o contrário, que é pior.
 */
const errosEstoque = computed<Record<string, string>>(() => {
  const achados: Record<string, string> = {};
  Requests.validarEstoquePorEmbalagem(
    {
      qtCad: Number(form.qtCad) || null,
      estoqueMin: Number(form.estoqueMin) || null,
      estoqueMax: Number(form.estoqueMax) || null,
    },
    {
      addIssue: (issue: { path?: PropertyKey[]; message?: string }) => {
        const campo = String(issue.path?.[0] ?? '');
        if (campo && !achados[campo]) achados[campo] = issue.message ?? '';
      },
    } as never,
  );
  return achados;
});

const mesmoValor = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Dois cadastros, um formulário.
 *
 * A BASE define o que o produto É — nome, código, embalagem, como se compra, e
 * se é revenda ou transformação com o grupo correspondente. Termina aí.
 *
 * A LOJA importa esse produto e completa o que é dela: estoque, custo, preço,
 * onde vende, fiscal e promoção. O que veio da BASE ela vê, mas não edita —
 * exceto ativar ou inativar na própria loja.
 *
 * Produto novo é sempre da BASE: quem cria é o admin, e as lojas recebem por
 * importação.
 */
const produtoSalvo = ref<Record<string, unknown> | null>(null);
const produtoBase = ref<Record<string, unknown> | null>(null);

/** Editando um produto que já pertence a uma loja? */
const modoLoja = computed(() => {
  const loja = produtoSalvo.value?.loja;
  return !!props.productId && !!loja && loja !== 'BASE';
});

/** Campos que vieram da BASE ficam legíveis, porém travados, na loja. */
const travadoNaLoja = computed(() => ({
  VTextField: { readonly: modoLoja.value },
  VSelect: { readonly: modoLoja.value },
  VCombobox: { readonly: modoLoja.value },
  VSwitch: { readonly: modoLoja.value },
  VBtnToggle: { disabled: modoLoja.value },
}));

/** Campos em que esta loja tem valor próprio — ou seja, que pararam de seguir a base. */
const camposEditadosNaLoja = computed(() => {
  const atual = produtoSalvo.value;
  const base = produtoBase.value;
  if (!atual || !base) return [];
  return CAMPOS_HERANCA.filter((c) => !mesmoValor(atual[c.campo], base[c.campo]));
});

/** Devolve o formulário aos valores da base. Promoções não são tocadas. */
function voltarAHerdar() {
  const base = produtoBase.value as Record<string, any> | null;
  if (!base) return;
  Object.assign(form, {
    nome: base.nome, quantidade: base.quantidade, medidaBase: base.medidaBase,
    pesavel: base.pesavel ?? null, teclaBalanca: base.teclaBalanca ?? null,
    validadeBalanca: base.validadeBalanca ?? null,
    marca: base.marca ?? '', embalagem: base.embalagem ?? '', cDe: base.cDe ?? 'DE',
    qtCad: base.qtCad, medidaCompra: base.medidaCompra ?? '',
    compraAproximada: base.compraAproximada ?? false, grupo: base.grupo ?? '',
    fotoUrl: base.fotoUrl ?? '', codigoBarras: base.codigoBarras ?? '',
    habilitarAjuda: base.habilitarAjuda, tipo: base.tipo,
  });
}

/**
 * Fatia 5 (prevenir): avisa na hora se o código de barras já existe neste
 * catálogo. Salvar já era recusado com DUPLICATE_PRODUCT — mas descobrir isso
 * só depois de preencher o formulário inteiro é o que faz a pessoa forçar.
 * Aviso, não bloqueio: existe caso legítimo de mesmo EAN (kit, fracionado).
 */
const barrasJaExiste = ref<{ nome: string; id: string } | null>(null);
let buscaBarras: ReturnType<typeof setTimeout> | null = null;

watch(() => form.codigoBarras, (valor) => {
  barrasJaExiste.value = null;
  if (buscaBarras) clearTimeout(buscaBarras);
  const codigo = (valor ?? "").replace(/\D/g, "");
  if (codigo.length < 6) return; // curto demais para significar alguma coisa
  buscaBarras = setTimeout(async () => {
    try {
      const achados = await api.findByCodigoBarras(codigo);
      const outro = achados.find((p) => p.id !== props.productId);
      barrasJaExiste.value = outro ? { nome: outro.nome, id: outro.id } : null;
    } catch {
      barrasJaExiste.value = null; // a busca é conveniência: falhar não atrapalha o cadastro
    }
  }, 500);
});

const groupTaxRules = ref<GroupTaxRule[]>([]);
const loadingGroups = ref(false);
const groupRulesError = ref('');
/*
 * Casa pela CHAVE normalizada, não pelo texto: os nomes de grupo carregam
 * U+2060 invisível e a comparação exata falhava sem deixar rastro — o grupo
 * aparecia escolhido na tela e a margem dele nunca era encontrada.
 */
const selectedTaxRule = computed(() => {
  const alvo = ProductRules.normalizarGrupo(form.grupo);
  if (!alvo) return null;
  return groupTaxRules.value.find((r) => ProductRules.normalizarGrupo(r.grupo) === alvo) ?? null;
});
const fiscalClassification = ref<FiscalClassification | null>(null);
const loadingFiscal = ref(false);
const automaticFiscal = computed(() => fiscalClassification.value ?? selectedTaxRule.value);
const groupItems = computed(() => {
  const items = groupTaxRules.value.map((r) => r.grupo);
  // Em edição, preserve e exiba o grupo já salvo mesmo quando a fonte externa
  // de regras estiver indisponível.
  if (form.grupo && !items.includes(form.grupo)) items.unshift(form.grupo);
  return items;
});

let classificationRequest = 0;
/** Margem padrão do grupo escolhido, em % para a tela (a planilha guarda fração). */
const margemDoGrupo = computed<number | null>(
  () => ProductRules.fracaoParaMargemPct(selectedTaxRule.value?.margemPadrao),
);

/*
 * Trocar o grupo aplica a margem padrão dele, quando existe. Hoje só 3 dos 76
 * grupos têm margem; nos outros o campo continua em branco para ser escrito à
 * mão, que é o comportamento de sempre.
 *
 * Só reage à TROCA de grupo: quem digitou uma margem e depois mexeu em outro
 * campo não pode ver o número mudar sozinho.
 */
watch(() => form.grupo, (novo, anterior) => {
  if (!novo || novo === anterior) return;
  const padrao = margemDoGrupo.value;
  if (padrao == null) return;
  form.margemPct = padrao;
});

watch([() => form.grupo, () => form.codigoBarras], async ([grupo, codigoBarras]) => {
  const request = ++classificationRequest;
  fiscalClassification.value = null;
  if (!grupo) return;
  loadingFiscal.value = true;
  try {
    const classification = await api.classifyFiscal(grupo, codigoBarras || undefined);
    if (request !== classificationRequest) return;
    fiscalClassification.value = classification;
    if (classification.ncm) form.ncm = classification.ncm;
    Object.assign(form, {
      cstPisCofins: classification.cstPisCofins,
      tributacaoSimples: classification.tributacaoSimples,
      aliquotaSimples: classification.aliquotaSimples,
      icmsRe: classification.icmsRe,
      baseFiscal: classification.baseFiscal,
      codigoFiscal: classification.codigoFiscal ?? '',
      produtoFiscal: classification.produtoFiscal ?? '',
      cstReforma: classification.cstReforma ?? '',
      cClassTrib: classification.cClassTrib ?? '',
      aliquotaIbs: classification.aliquotaIbs ?? 0,
      aliquotaCbs: classification.aliquotaCbs ?? 0,
      origemFiscal: classification.origem,
    });
  } catch {
    if (request === classificationRequest) fiscalClassification.value = null;
  } finally {
    if (request === classificationRequest) loadingFiscal.value = false;
  }
});

const DIAS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

const saving = ref(false);
const uploadingFoto = ref(false);
const fotoComFundoPralis = ref(false);
const progressoFotoIa = ref(0);
const erro = ref('');

async function onFoto(files: File | File[] | null) {
  const file = Array.isArray(files) ? files[0] : files;
  if (!file) return;
  uploadingFoto.value = true;
  progressoFotoIa.value = 0;
  erro.value = '';
  try {
    const arquivoParaEnviar = fotoComFundoPralis.value
      ? await aplicarFundoPralisComIa(file, (percentual) => (progressoFotoIa.value = percentual))
      : file;
    form.fotoUrl = await api.uploadFoto(arquivoParaEnviar);
  } catch (e: unknown) {
    erro.value = e instanceof Error ? e.message : (e as { data?: { message?: string } })?.data?.message || 'Falha no upload da foto.';
  } finally {
    uploadingFoto.value = false;
    progressoFotoIa.value = 0;
  }
}

// leitor de código de barras pela câmera
const scanOpen = ref(false);
function onScanned(code: string) {
  form.codigoBarras = code;
}

// No Android, um seletor sem `capture` pode oferecer apenas a galeria. Os dois
// inputs deixam explícito se a pessoa quer a câmera traseira ou um arquivo salvo.
const cameraInput = ref<HTMLInputElement | null>(null);
const galleryInput = ref<HTMLInputElement | null>(null);
function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (f) onFoto(f);
  // Permite selecionar/tirar novamente a mesma foto depois de uma tentativa.
  input.value = '';
}
function onDrop(e: DragEvent) {
  const f = e.dataTransfer?.files?.[0];
  if (f) onFoto(f);
}

// ---- preview ao vivo (regras compartilhadas) ----
const descricao = computed(() => ProductRules.montarDescricao(form.nome, form.quantidade, form.medidaBase));
const vVenda = computed(() =>
  ProductRules.calcularVVenda({
    auto: form.auto,
    custo: Number(form.custo) || 0,
    qtCad: Number(form.qtCad) || 1,
    margemPontual: ProductRules.margemPctParaFracao(form.margemPct),
    margemGrupo: ProductRules.margemPctParaFracao(margemDoGrupo.value) ?? 0,
    vVendaPontual: Number(form.vVendaPontual) || 0,
    descricao: descricao.value,
  }),
);
const validacaoQtd = computed(() =>
  form.tipo === 'transformacao'
    ? ProductRules.montarValidacaoQtd(descricao.value, form.precisao, Number(form.qtdTransf) || 0, form.unidadeTransf)
    : '',
);

/*
 * "Como se compra" vem da MESMA função que o servidor usa para a planilha.
 * A tela tinha a própria cópia da regra, e as duas já produziam textos
 * diferentes — a daqui dizia "Caixa com 20 KG — ..." e a do servidor
 * "1 CX C/ (...)". Uma regra só, um texto só.
 */
const comoSeCompra = computed(() => ProductRules.montarComoSeCompra({
  embalagem: form.embalagem,
  cDe: form.cDe,
  qtCad: Number(form.qtCad) || 0,
  medidaCompra: form.medidaCompra,
  descricao: descricao.value,
  aproximado: form.compraAproximada,
}));

// UX-02: estoque, setor, custo e margem são do PRODUTO (valem para revenda E transformação)
/*
 * Limpar o campo significa "sem margem pontual" e precisa CONTINUAR nulo — o
 * `|| 0` de antes transformava vazio em zero, e zero manda vender pelo custo.
 */
/** Algum destino externo ficou para trás? Só isso decide a cor do aviso. */
function pendenciaDeEspelho(details: { sheetSync?: string; espelhoLoja?: string } | undefined): boolean {
  const s = details?.sheetSync;
  // "pending" NÃO acende o aviso vermelho: a planilha só está lenta, e a fila
  // de reenvio termina o serviço sozinha em poucos minutos. Pintar de erro o
  // que vai se resolver ensina a pessoa a ignorar o aviso que importa.
  return s === 'failed' || s === 'misconfigured' || details?.espelhoLoja === 'falhou';
}

function clampMargem() {
  if (form.margemPct == null || String(form.margemPct).trim() === '') {
    form.margemPct = null;
    return;
  }
  const n = Number(form.margemPct);
  form.margemPct = Number.isFinite(n) ? Math.min(1000, Math.max(0, n)) : null;
}

// "Habilitar ajuda": mostra dicas nos campos quando focados (hint só aparece no foco)
const dicas: Record<string, string> = {
  nome: 'Nome do produto, sem a gramatura. Ex.: "Talento Meio Amargo".',
  quantidade: 'Gramatura/peso da unidade. Ex.: 25 (para 25 g).',
  medidaBase: 'Unidade da gramatura: UN, KG, G, LT ou ML.',
  marca: 'Marca/fabricante do produto.',
  codigoBarras: 'Código de barras (EAN) do produto, se houver.',
  embalagem: 'Embalagem de compra: saco, caixa, pacote, fardo...',
  cDe: 'C/ = "com" (caixa com 12). DE = "de" (saco de 25 kg).',
  qtCad: 'Quantas unidades/medidas vêm na embalagem de compra.',
  medidaCompra: 'Unidade da embalagem de compra (UN, KG, LT).',
  grupo: 'Grupo de mercadorias. Define a regra fiscal e a margem padrão.',
  compraAproximada: 'Aproximado escreve "aproximadamente" na frase. Use para peso variável, como caixa de queijo.',
  setorEstoque: 'Onde o produto fica armazenado.',
  setorVenda1: 'Setor em que o produto é vendido. Não é o setor de estoque.',
  setorVenda2: 'Segundo setor de venda, quando o produto é vendido em mais de um.',
  localVenda1: 'Onde o produto é exposto para venda.',
  localVenda2: 'Segundo local de exposição, quando houver.',
  estoqueMin: 'Quantidade mínima desejada em estoque.',
  estoqueMax: 'Quantidade máxima desejada em estoque.',
  custo: 'Preço de custo do produto (R$).',
  vVendaPontual: 'Preço de venda definido na mão (quando o cálculo automático está desligado).',
  precisao: 'EXATOS (peso fixo) ou APROXIMADOS (varia um pouco).',
  qtdTransf: 'Quantidade usada na transformação/receita.',
  unidadeTransf: 'Unidade da quantidade de transformação (UN, G, ML).',
  produtoReceituario: 'Produto/ingrediente do receituário, se aplicável.',
  refReceituario: 'Referência do receituário, se aplicável.',
  ncm: 'Código NCM do produto (informação fiscal).',
  cest: 'Código CEST, quando o produto exige.',
  categoria: 'Categoria fiscal do produto.',
  cstPisCofins: 'CST de PIS/COFINS.',
  aliquotaCheia: 'Alíquota cheia (%).',
  aliquotaFcp: 'Alíquota do FCP (%).',
  icms: 'Alíquota de ICMS (%).',
  aliquotaPis: 'Alíquota de PIS (%).',
  aliquotaCofins: 'Alíquota de COFINS (%).',
  reducaoIcms: 'Percentual de redução da base de ICMS (%).',
};
const ajuda = (campo: string) => (form.habilitarAjuda ? dicas[campo] : undefined);

/**
 * Como cada estado fiscal aparece na tela.
 *
 * O texto técnico do servidor (`pendente_grupo_invalido`) não serve para quem
 * está cadastrando. E `quemResolve` existe porque a loja não pode consertar
 * grupo — o campo é somente leitura para ela —, então mandar "corrija o grupo"
 * sem dizer ONDE seria pedir o impossível.
 */
const FISCAL_NA_TELA: Record<string, {
  rotulo: string; cor: string; icone: string; tipo: 'success' | 'warning' | 'info';
  quemResolve?: string;
}> = {
  completo: { rotulo: 'completo', cor: 'success', icone: 'check_circle', tipo: 'success' },
  nao_classificado: { rotulo: 'não classificado', cor: 'warning', icone: 'schedule', tipo: 'info' },
  parcial: { rotulo: 'parcial', cor: 'warning', icone: 'info', tipo: 'info' },
  pendente_grupo_invalido: {
    rotulo: 'grupo inválido', cor: 'error', icone: 'error', tipo: 'warning',
    quemResolve: 'O grupo é definido na BASE pelo administrador.',
  },
  pendente_sem_correspondencia: { rotulo: 'sem registro fiscal', cor: 'warning', icone: 'help', tipo: 'info' },
  pendente_ambiguo: {
    rotulo: 'ambíguo', cor: 'error', icone: 'help', tipo: 'warning',
    quemResolve: 'Precisa de decisão: há mais de um registro com este nome.',
  },
  pendente_conflito: {
    rotulo: 'conflito fiscal', cor: 'error', icone: 'warning', tipo: 'warning',
    quemResolve: 'Precisa de decisão do contador.',
  },
  pendente_fonte_da_loja: {
    rotulo: 'sem cadastro de ECF da loja', cor: 'warning', icone: 'store', tipo: 'info',
    quemResolve: 'A alíquota de ECF vem do Creare de cada loja. Falta o cadastro desta.',
  },
  fonte_indisponivel: { rotulo: 'fonte fora do ar', cor: 'grey', icone: 'cloud_off', tipo: 'info' },
};

const estadoFiscal = computed(() => {
  const estado = form.estadoFiscal;
  if (!estado) return null;
  const visual = FISCAL_NA_TELA[estado];
  if (!visual) return null;
  return { ...visual, motivo: estado === 'completo' ? '' : form.motivoFiscal };
});

/**
 * Impede que a roda do mouse altere um campo numérico.
 *
 * É comportamento padrão do navegador: com o campo FOCADO, rolar a página
 * incrementa ou decrementa o número. Quem preencheu "Estoque mín." e rolou a
 * tela para continuar o cadastro via o 10 virar 9 sem tocar em nada — e o
 * cadastro seguia para a planilha errado, sem aviso nenhum.
 *
 * Tirar o foco no `wheel` devolve a rolagem à página, que é o que a pessoa
 * queria fazer.
 */
function semRolagemNoNumero(e: WheelEvent) {
  (e.target as HTMLElement | null)?.blur();
}

function buildFiscal() {
  const automatic = automaticFiscal.value;
  const has =
    form.ncm || form.cest || form.categoria || form.cstPisCofins ||
    form.aliquotaCheia || form.aliquotaFcp || form.aliquotaPis ||
    form.aliquotaCofins || form.reducaoIcms || form.icms || automatic;
  if (!has) return null;
  return {
    ncm: form.ncm || null,
    cest: form.cest || null,
    categoria: form.categoria || null,
    cstPisCofins: automatic?.cstPisCofins ?? (form.cstPisCofins || null),
    aliquotaCheia: Number(form.aliquotaCheia) || null,
    aliquotaFcp: Number(form.aliquotaFcp) || null,
    aliquotaPis: Number(form.aliquotaPis) || null,
    aliquotaCofins: Number(form.aliquotaCofins) || null,
    reducaoIcms: Number(form.reducaoIcms) || null,
    icms: Number(form.icms) || null,
    tributacaoSimples: automatic?.tributacaoSimples ?? (form.tributacaoSimples || null),
    aliquotaSimples: automatic?.aliquotaSimples ?? (Number(form.aliquotaSimples) || null),
    icmsRe: automatic?.icmsRe ?? (Number(form.icmsRe) || null),
    baseFiscal: automatic?.baseFiscal ?? (form.baseFiscal || null),
    codigoFiscal: fiscalClassification.value?.codigoFiscal ?? (form.codigoFiscal || null),
    produtoFiscal: fiscalClassification.value?.produtoFiscal ?? (form.produtoFiscal || null),
    cstReforma: fiscalClassification.value?.cstReforma ?? (form.cstReforma || null),
    cClassTrib: fiscalClassification.value?.cClassTrib ?? (form.cClassTrib || null),
    aliquotaIbs: fiscalClassification.value?.aliquotaIbs ?? (Number(form.aliquotaIbs) || null),
    aliquotaCbs: fiscalClassification.value?.aliquotaCbs ?? (Number(form.aliquotaCbs) || null),
    origemFiscal: fiscalClassification.value?.origem ?? (form.origemFiscal || null),
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

function buildPayload(forcar = false): ProductRequests.CreateProductRequest {
  const revenda = form.tipo === 'revenda';
  const payload: ProductRequests.CreateProductRequest = {
    nome: form.nome,
    quantidade: Number(form.quantidade) || 0,
    medidaBase: form.medidaBase as ProductRequests.CreateProductRequest['medidaBase'],
    pesavel: form.pesavel,
    teclaBalanca: form.pesavel === 'S' ? TECLA_BALANCA_FIXA : null,
    validadeBalanca: form.pesavel === 'S' ? form.validadeBalanca : null,
    codigoBarras: form.codigoBarras || null,
    marca: form.marca || null,
    embalagem: (form.embalagem || null) as ProductRequests.CreateProductRequest['embalagem'],
    cDe: (form.cDe || null) as ProductRequests.CreateProductRequest['cDe'],
    qtCad: Number(form.qtCad) || 1,
    medidaCompra: (form.medidaCompra || null) as ProductRequests.CreateProductRequest['medidaCompra'],
    compraAproximada: form.compraAproximada,
    // Na criação a API gera o código. Na edição ele precisa voltar
    // intacto; enviar null apagava silenciosamente o identificador existente.
    codigoInterno: props.productId ? (form.codigoInterno || null) : null,
    fotoUrl: form.fotoUrl || null,
    grupo: form.grupo || null,
    tipo: form.tipo,
    status: form.status,
    habilitarAjuda: form.habilitarAjuda,
    // Promoção é da loja (será movida para a tela do gerente — UX-06).
    promocoes: modoLoja.value && revenda ? buildPromocoes() : [],
    transformacao: revenda
      ? null
      : {
          precisao: form.precisao as 'EXATOS' | 'APROXIMADOS',
          qtd: Number(form.qtdTransf) || 0,
          unidade: form.unidadeTransf as 'UN' | 'G' | 'ML',
          produtoReceituario: form.produtoReceituario || null,
          refReceituario: form.refReceituario || null,
        },
    fiscal: buildFiscal(),
    forcar,
  };

  /*
   * Estoque, custo, preço e local de venda vão SEMPRE, na Base também.
   *
   * Até 28/09/2026 a Base omitia estes campos, por um motivo que fazia sentido
   * na época: cadastro legado com estoque inválido travava a edição de um
   * campo que o administrador nem via. Só que na CRIAÇÃO o contrato exige os
   * campos, e omiti-los devolvia "expected number, received undefined" — o
   * cadastro de produto novo na Base parou de funcionar sem ninguém notar.
   *
   * E o modelo mudou: a carga de 25/09 guarda custo, preço e estoque na Base,
   * e a cópia da loja nasce com esses valores (regra do José: *"traga de volta
   * o cadastro completo para base, e depois cada loja edita"*). Os campos agora
   * aparecem na Base, então o valor legado inválido também pode ser corrigido
   * ali, e o motivo da omissão deixou de existir.
   */
  payload.estoqueMin = Number(form.estoqueMin) || null;
  payload.estoqueMax = Number(form.estoqueMax) || null;
  payload.setorEstoque = form.setorEstoque || null;
  payload.setorVenda1 = form.setorVenda1 || null;
  payload.areaVenda = form.areaVenda;
  payload.setorVenda2 = form.setorVenda2 || null;
  payload.custo = Number(form.custo) || null;
  payload.margemPontual = ProductRules.margemPctParaFracao(form.margemPct);
  payload.vVendaPontual = Number(form.vVendaPontual) || null;
  payload.auto = form.auto;
  payload.localVenda1 = form.localVenda1 || null;
  payload.localVenda2 = form.localVenda2 || null;

  return payload;
}

const duplicado = ref('');

async function salvar(forcar = false) {
  if (!form.nome.trim()) { erro.value = 'Informe o nome do produto.'; return; }
  if (form.pesavel !== 'S' && form.pesavel !== 'N') {
    erro.value = 'Escolha Sim ou Não para o campo Vai para balança.';
    return;
  }
  if (form.pesavel === 'S' && (typeof form.validadeBalanca !== 'number'
    || !Number.isInteger(form.validadeBalanca) || form.validadeBalanca < 0 || form.validadeBalanca > 999)) {
    erro.value = 'Informe a validade da balança em dias (0 a 999).';
    return;
  }
  const grupoOriginal = produtoSalvo.value?.grupo;
  if (!form.grupo && (!props.productId || grupoOriginal)) {
    erro.value = 'Selecione o grupo de mercadorias para aplicar os impostos.';
    return;
  }
  saving.value = true;
  erro.value = '';
  duplicado.value = '';
  try {
    const payload = buildPayload(forcar);
    const res = props.productId
      ? await api.updateProduct(props.productId, payload)
      : await api.createProduct(payload);
    /*
     * A mensagem vem do SERVIDOR. Ela era remontada aqui, e as duas versões já
     * divergiam: o servidor passou a avisar quando a aba da loja não recebeu, e
     * a tela continuava dizendo "atualizado com sucesso".
     *
     * O produto está salvo em todos os casos — falha de destino externo é
     * aviso, nunca erro de cadastro. Daí warning e não error.
     */
    flash.value = { texto: res.message, tipo: pendenciaDeEspelho(res.details) ? 'warning' : 'success' };
    await navigateTo('/');
  } catch (e: unknown) {
    const err = e as { data?: { message?: string; details?: { code?: string } } };
    if (err?.data?.details?.code === 'DUPLICATE_PRODUCT') {
      duplicado.value = err.data.message || 'Produto já cadastrado nesta loja.';
    } else {
      erro.value = err?.data?.message || 'Erro ao salvar. Confira os campos.';
    }
  } finally {
    saving.value = false;
  }
}

// ---- carregar para edição ----
onMounted(async () => {
  loadingGroups.value = true;
  try {
    groupTaxRules.value = await api.listGroupTaxRules();
    groupRulesError.value = '';
  } catch (e: unknown) {
    groupRulesError.value = (e as { data?: { message?: string } })?.data?.message
      || 'Não foi possível carregar os grupos e as regras fiscais.';
  } finally {
    loadingGroups.value = false;
  }
  if (!props.productId) return;
  try {
    const p = await api.getProduct(props.productId);
    Object.assign(form, {
      nome: p.nome, quantidade: p.quantidade, medidaBase: p.medidaBase,
      pesavel: p.pesavel ?? null, teclaBalanca: p.teclaBalanca ?? null,
      validadeBalanca: p.validadeBalanca ?? null,
      marca: p.marca ?? '', embalagem: p.embalagem ?? '', cDe: p.cDe ?? 'DE',
      qtCad: p.qtCad, medidaCompra: p.medidaCompra ?? '', grupo: p.grupo ?? '', fotoUrl: p.fotoUrl ?? '',
      codigoBarras: p.codigoBarras ?? '', codigoInterno: p.codigoInterno ?? '',
      status: p.status, habilitarAjuda: p.habilitarAjuda, tipo: p.tipo,
    });
    Object.assign(form, {
      custo: p.custo ?? 0, margemPct: ProductRules.fracaoParaMargemPct(p.margemPontual),
      auto: p.auto, vVendaPontual: p.vVendaPontual ?? 0,
      estoqueMin: p.estoqueMin ?? 0, estoqueMax: p.estoqueMax ?? 0, setorEstoque: p.setorEstoque ?? '',
      localVenda1: p.localVenda1 ?? '', localVenda2: p.localVenda2 ?? '',
      setorVenda1: p.setorVenda1 ?? '', setorVenda2: p.setorVenda2 ?? '',
      areaVenda: p.areaVenda ?? null,
    });
    if (p.transformacao) Object.assign(form, {
      precisao: p.transformacao.precisao, qtdTransf: p.transformacao.qtd, unidadeTransf: p.transformacao.unidade,
      produtoReceituario: p.transformacao.produtoReceituario ?? '', refReceituario: p.transformacao.refReceituario ?? '',
    });
    if (p.fiscal) Object.assign(form, {
      ncm: p.fiscal.ncm ?? '', cest: p.fiscal.cest ?? '', categoria: p.fiscal.categoria ?? '', cstPisCofins: p.fiscal.cstPisCofins ?? '',
      estadoFiscal: p.fiscal.estado ?? '', motivoFiscal: p.fiscal.motivo ?? '',
      aliquotaCheia: p.fiscal.aliquotaCheia ?? 0, aliquotaFcp: p.fiscal.aliquotaFcp ?? 0,
      aliquotaPis: p.fiscal.aliquotaPis ?? 0, aliquotaCofins: p.fiscal.aliquotaCofins ?? 0,
      reducaoIcms: p.fiscal.reducaoIcms ?? 0, icms: p.fiscal.icms ?? 0,
      tributacaoSimples: p.fiscal.tributacaoSimples ?? '', aliquotaSimples: p.fiscal.aliquotaSimples ?? 0,
      icmsRe: p.fiscal.icmsRe ?? 0, baseFiscal: p.fiscal.baseFiscal ?? '',
      codigoFiscal: p.fiscal.codigoFiscal ?? '', produtoFiscal: p.fiscal.produtoFiscal ?? '',
      cstReforma: p.fiscal.cstReforma ?? '', cClassTrib: p.fiscal.cClassTrib ?? '',
      aliquotaIbs: p.fiscal.aliquotaIbs ?? 0, aliquotaCbs: p.fiscal.aliquotaCbs ?? 0,
      origemFiscal: p.fiscal.origemFiscal ?? '',
    });
    const promo = p.promocoes?.[0];
    if (promo) Object.assign(form, {
      promoTipo: promo.tipo, promoValor: promo.valor ?? 0,
      promoDescontoPct: promo.descontoPct ? promo.descontoPct * 100 : 0,
      promoHoraInicio: promo.horaInicio ?? '', promoHoraFim: promo.horaFim ?? '',
      promoDias: promo.dias ?? [false, false, false, false, false, false, false],
    });
    produtoSalvo.value = p as unknown as Record<string, unknown>;
    if (p.baseProductId) {
      // o catálogo BASE é legível por qualquer usuário autenticado
      try {
        produtoBase.value = (await api.getProduct(p.baseProductId)) as unknown as Record<string, unknown>;
      } catch {
        produtoBase.value = null; // sem a base, o selo simplesmente não aparece
      }
    }
  } catch {
    erro.value = 'Não foi possível carregar o produto.';
  }
});
</script>

<template>
  <div class="product-form cx-page">
    <div class="product-form__intro">
      <v-btn icon="arrow_back" variant="text" to="/" aria-label="Voltar para produtos" />
      <div>
        <div class="cx-section-label">CATÁLOGO DE PRODUTOS</div>
        <h1>{{ productId ? 'Editar produto' : 'Novo produto' }}</h1>
        <p>Dados do cadastro, operação da loja e informações fiscais em um só lugar.</p>
      </div>
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>
    <v-alert v-if="groupRulesError" type="warning" variant="tonal" class="mb-4">
      <strong>Regras fiscais indisponíveis.</strong> {{ groupRulesError }}
      <div class="text-body-2 mt-1">
        Você pode editar outros dados de um produto existente sem trocar grupo ou código de barras.
        Novos cadastros e reclassificações continuam bloqueados para evitar imposto incorreto.
      </div>
    </v-alert>

    <!-- HERANÇA: o que ainda segue a base e o que esta loja passou a mandar -->
    <v-card v-if="produtoBase" flat border rounded="lg" class="product-form__notice mb-4">
      <v-card-text class="d-flex align-center flex-wrap ga-2">
        <template v-if="camposEditadosNaLoja.length === 0">
          <span class="text-body-2">
            Este produto <strong>segue a base</strong> em todos os campos — o que o administrador
            alterar lá desce para cá automaticamente.
          </span>
        </template>
        <template v-else>
          <span class="text-body-2">
            <strong>{{ camposEditadosNaLoja.length }}</strong>
            campo(s) foram editados nesta loja e <strong>não seguem mais a base</strong>:
          </span>
          <v-chip
            v-for="c in camposEditadosNaLoja"
            :key="c.campo"
            size="small"
            color="warning"
            variant="tonal"
          >{{ c.label }}</v-chip>
          <v-spacer />
          <v-btn size="small" variant="text" @click="voltarAHerdar">Voltar a herdar da base</v-btn>
        </template>
      </v-card-text>
    </v-card>

    <v-alert v-if="duplicado" type="warning" variant="tonal" class="mb-4">
      <div class="d-flex align-center flex-wrap ga-2">
        <span>{{ duplicado }}</span>
        <v-spacer />
        <v-btn size="small" color="warning" variant="flat" :loading="saving" @click="salvar(true)">
          Cadastrar mesmo assim
        </v-btn>
      </div>
    </v-alert>

    <v-alert v-if="modoLoja" type="info" variant="tonal" density="compact" class="mb-4">
      Este produto veio da base. Os campos do cadastro geral estão em leitura —
      só o administrador os altera, e a mudança desce para as lojas.
      Aqui você completa o que é da sua loja e pode ativar ou inativar.
    </v-alert>

    <!-- PRODUTO (cadastro inicial + geral unificados — UX-03) -->
    <v-card flat border rounded="lg" class="product-form__card mb-4">
      <v-card-title class="product-form__card-heading">
        <span class="product-form__icon"><v-icon icon="inventory_2" size="20" /></span>
        <span class="product-form__heading-copy"><strong>Produto</strong><small>Identificação e apresentação no catálogo</small></span>
      </v-card-title>
      <v-card-text>
        <!--
          Na loja, tudo aqui e leitura: o que o produto E vem da BASE. O status
          escapa logo abaixo, porque ativar/inativar e decisao de cada loja.
        -->
        <v-defaults-provider :defaults="travadoNaLoja">
        <v-row dense>
          <!--
            O status é o único campo do cadastro geral que a loja mexe: um
            produto pode estar ativo numa loja e inativo na outra.
          -->
          <!-- status (primeiro campo) ao lado da foto -->
          <v-col cols="12" sm="5">
            <v-select
              v-model="form.status"
              :items="['ativo', 'inativo']"
              :readonly="false"
              label="Status"
              variant="outlined"
              density="comfortable"
              hide-details
              class="mb-3"
            />
            <v-switch v-model="form.habilitarAjuda" label="Habilitar ajuda" color="primary" inset hide-details />
          </v-col>
          <!-- foto: dropzone (clique ou arraste) -->
          <v-col cols="12" sm="7">
            <div class="dropzone" :class="{ 'dropzone--full': form.fotoUrl }" @dragover.prevent @drop.prevent="onDrop">
              <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="d-none" @change="onPick" >
              <input ref="galleryInput" type="file" accept="image/*" class="d-none" @change="onPick" >
              <template v-if="form.fotoUrl">
                <v-img :src="form.fotoUrl" height="120" cover class="rounded-lg" />
                <div class="d-flex justify-center ga-2 mt-2 flex-wrap">
                  <v-btn size="small" variant="tonal" color="primary" prepend-icon="photo_camera" :disabled="uploadingFoto" @click.stop="cameraInput?.click()">Tirar foto</v-btn>
                  <v-btn size="small" variant="tonal" color="primary" prepend-icon="photo_library" :disabled="uploadingFoto" @click.stop="galleryInput?.click()">Galeria</v-btn>
                  <v-btn size="small" variant="text" color="error" prepend-icon="delete" @click.stop="form.fotoUrl = ''">Remover</v-btn>
                </div>
              </template>
              <template v-else>
                <v-progress-circular v-if="uploadingFoto" :model-value="fotoComFundoPralis ? progressoFotoIa : undefined" :indeterminate="!fotoComFundoPralis" color="primary" class="mb-2" />
                <v-icon v-else size="38" color="primary" class="mb-2">cloud_upload</v-icon>
                <div class="text-body-2 font-weight-medium">Adicione uma foto do produto</div>
                <div class="text-caption text-medium-emphasis mb-2">PNG, JPG aceitos</div>
                <div class="d-flex justify-center ga-2 flex-wrap">
                  <v-btn size="small" color="primary" variant="flat" rounded="lg" prepend-icon="photo_camera" :loading="uploadingFoto" @click.stop="cameraInput?.click()">Tirar foto</v-btn>
                  <v-btn size="small" color="primary" variant="tonal" rounded="lg" prepend-icon="photo_library" :disabled="uploadingFoto" @click.stop="galleryInput?.click()">Galeria</v-btn>
                </div>
              </template>
            </div>
            <v-switch v-model="fotoComFundoPralis" color="primary" density="compact" hide-details :disabled="uploadingFoto" label="Padronizar fundo com a IA Cicluz" class="mt-2" @click.stop />
            <div class="text-caption text-medium-emphasis">Remove o fundo e aplica o fundo branco antes do upload.</div>
          </v-col>
          <!-- código de barras abaixo da foto (UX-03) -->
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="form.codigoBarras"
              label="Código de barras"
              variant="outlined"
              density="comfortable"
              :hint="ajuda('codigoBarras')"
              append-inner-icon="barcode_scanner"
              @click:append-inner="scanOpen = true"
            />
            <v-alert
              v-if="barrasJaExiste"
              type="warning"
              variant="tonal"
              density="compact"
              class="mt-1"
            >
              Já existe <strong>{{ barrasJaExiste.nome }}</strong> com este código de barras neste
              catálogo. Confira antes de cadastrar de novo —
              <NuxtLink :to="`/produtos/${barrasJaExiste.id}`" class="text-primary">abrir o existente</NuxtLink>.
            </v-alert>
          </v-col>
          <v-col v-if="productId" cols="12" sm="6">
            <v-text-field
              v-model="form.codigoInterno"
              label="Código interno"
              variant="outlined"
              density="comfortable"
              readonly
              bg-color="grey-lighten-4"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.marca" label="Marca" variant="outlined" density="comfortable" :hint="ajuda('marca')" />
          </v-col>
          <v-col cols="12">
            <v-text-field v-model="form.nome" label="Nome do produto *" variant="outlined" density="comfortable" :hint="ajuda('nome')" />
          </v-col>
          <v-col cols="6">
            <v-text-field v-model.number="form.quantidade" type="number" @wheel="semRolagemNoNumero" label="Gramatura" variant="outlined" density="comfortable" :hint="ajuda('quantidade')" />
          </v-col>
          <v-col cols="6">
            <v-select v-model="form.medidaBase" :items="MEDIDAS_BASE" label="Medida base" variant="outlined" density="comfortable" :hint="ajuda('medidaBase')" />
          </v-col>
          <v-col cols="12" sm="6">
            <v-select v-model="form.pesavel" :items="[{ title: 'Não', value: 'N' }, { title: 'Sim', value: 'S' }]" label="Vai para balança?" variant="outlined" density="comfortable" persistent-hint hint="Novos produtos começam em Não. Para produtos já existentes, confira o cadastro SIA; a medida KG não define este campo." />
          </v-col>
          <template v-if="form.pesavel === 'S'">
            <v-col cols="6" sm="3">
              <v-text-field :model-value="teclaBalancaExibicao" label="Tecla da balança" variant="outlined" density="comfortable" readonly persistent-hint hint="Valor fixo 000 confirmado para a TNP." />
            </v-col>
            <v-col cols="6" sm="3">
              <v-text-field v-model.number="form.validadeBalanca" type="number" min="0" max="999" @wheel="semRolagemNoNumero" label="Validade na balança (dias)" variant="outlined" density="comfortable" persistent-hint hint="Informe o número de dias definido para este produto." />
            </v-col>
          </template>
          <v-col cols="12">
            <v-text-field :model-value="descricao" label="Descrição (automática)" variant="outlined" density="comfortable" readonly bg-color="grey-lighten-4" />
          </v-col>

          <!-- COMO SE COMPRA (UX-04) -->
          <v-col cols="12"><div class="product-form__subheading"><strong>Como se compra</strong><span>Embalagem e unidade de compra</span></div></v-col>
          <v-col cols="6" sm="3">
            <v-select v-model="form.embalagem" :items="EMBALAGENS" label="Embalagem" variant="outlined" density="comfortable" clearable :hint="ajuda('embalagem')" />
          </v-col>
          <v-col cols="6" sm="3">
            <v-select v-model="form.cDe" :items="['C/', 'DE']" label="C/DE" variant="outlined" density="comfortable" :hint="ajuda('cDe')" />
          </v-col>
          <v-col cols="6" sm="3">
            <v-text-field v-model.number="form.qtCad" type="number" @wheel="semRolagemNoNumero" label="Qt. embalagem" variant="outlined" density="comfortable" :hint="ajuda('qtCad')" />
          </v-col>
          <v-col cols="6" sm="3">
            <v-select v-model="form.medidaCompra" :items="MEDIDAS_COMPRA" label="Medida de compra" variant="outlined" density="comfortable" clearable :hint="ajuda('medidaCompra')" />
          </v-col>
          <v-col cols="12" sm="3">
            <v-select
              v-model="form.compraAproximada"
              :items="[{ title: 'Exato', value: false }, { title: 'Aproximado', value: true }]"
              label="Quantidade da embalagem"
              variant="outlined"
              density="comfortable"
              :hint="ajuda('compraAproximada')"
            />
          </v-col>
          <v-col cols="12">
            <!--
              Uma linha só, mas sem perder o fim da frase: a fonte encolhe o
              suficiente para caber o caso comum, e o texto inteiro fica no
              title (aparece ao passar o mouse) e rola na horizontal quando o
              campo recebe o clique. Cortar sem saída era o problema.
            -->
            <v-text-field
              :model-value="comoSeCompra"
              :title="comoSeCompra"
              label="Como se compra (automático)"
              variant="outlined"
              density="comfortable"
              readonly
              bg-color="grey-lighten-4"
              placeholder="Preencha a embalagem para gerar"
              class="como-se-compra"
            />
          </v-col>
        </v-row>
        </v-defaults-provider>
      </v-card-text>
    </v-card>

    <!-- REVENDA OU TRANSFORMAÇÃO (seletor único — UX-01) -->
    <v-card flat border rounded="lg" class="product-form__card mb-4">
      <v-card-title class="product-form__card-heading">
        <span class="product-form__icon"><v-icon icon="category" size="20" /></span>
        <span class="product-form__heading-copy"><strong>Revenda ou transformação</strong><small>Classificação e operação do produto</small></span>
      </v-card-title>
      <v-card-text>
        <v-btn-toggle v-model="form.tipo" :disabled="modoLoja" mandatory color="primary" divided class="product-form__toggle mb-4">
          <v-btn value="revenda">Revenda</v-btn>
          <v-btn value="transformacao">Transformação</v-btn>
        </v-btn-toggle>

        <v-row dense>
          <!--
            O grupo é escolha da BASE: é ele que define a regra fiscal. A loja
            vê qual é, e não troca.
          -->
          <!--
            Ordem pedida pelo José em 09/09/2026: grupo em cima, depois setor de
            estoque com os limites AO LADO (é a mesma decisão: onde guarda e
            quanto guarda), e só então onde o produto é vendido.

            O grupo saiu do cartão fiscal e veio para cá porque é escolha de
            cadastro; ele continua disparando a classificação fiscal igual.
          -->
          <v-col cols="12">
            <v-autocomplete
              v-model="form.grupo"
              :items="groupItems"
              :loading="loadingGroups"
              :readonly="modoLoja"
              label="Grupo de mercadorias *"
              variant="outlined"
              density="comfortable"
              placeholder="Digite parte do nome, ex.: LEITE"
              :no-data-text="groupItems.length ? 'Nenhum grupo encontrado' : 'Nenhum grupo fiscal disponível'"
              :hint="ajuda('grupo')"
            />
          </v-col>

          <!--
            Estoque, custo e preço aparecem na BASE também. A carga guarda esses
            valores na Base e a cópia da loja nasce com eles; cada loja edita
            depois o que for dela. Sem isto, o cadastro de produto novo na Base
            não passava no contrato de criação (28/09/2026).
          -->
          <v-col cols="12"><div class="product-form__subheading"><strong>{{ modoLoja ? 'Desta loja' : 'Operação' }}</strong><span>Estoque, pontos de venda e preço</span></div></v-col>
          <v-col cols="12" sm="6">
            <v-select v-model="form.setorEstoque" :items="SETORES" label="Setor de estoque" variant="outlined" density="comfortable" clearable :hint="ajuda('setorEstoque')" />
          </v-col>
          <v-col cols="6" sm="3">
            <v-text-field v-model.number="form.estoqueMin" type="number" @wheel="semRolagemNoNumero" label="Estoque mín." variant="outlined" density="comfortable" :hint="ajuda('estoqueMin')" :error-messages="errosEstoque.estoqueMin" />
          </v-col>
          <v-col cols="6" sm="3">
            <v-text-field v-model.number="form.estoqueMax" type="number" @wheel="semRolagemNoNumero" label="Estoque máx." variant="outlined" density="comfortable" :hint="ajuda('estoqueMax')" :error-messages="errosEstoque.estoqueMax" />
          </v-col>

          <v-col cols="12" sm="6">
            <v-text-field v-model="form.localVenda1" label="Local de venda primário" variant="outlined" density="comfortable" clearable :hint="ajuda('localVenda1')" />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.localVenda2" label="Local de venda secundário" variant="outlined" density="comfortable" clearable :hint="ajuda('localVenda2')" />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.setorVenda1" label="Setor de venda primário" variant="outlined" density="comfortable" clearable :hint="ajuda('setorVenda1')" />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field v-model="form.setorVenda2" label="Setor de venda secundário" variant="outlined" density="comfortable" clearable :hint="ajuda('setorVenda2')" />
          </v-col>
          <v-col v-if="produtoSalvo?.loja === 'TNP'" cols="12" sm="6">
            <v-select v-model="form.areaVenda" :items="AREAS_VENDA_TNP" label="Área da loja (Relatório Gerentes)" variant="outlined" density="comfortable" clearable
              hint="A escolha manual prevalece. Se ficar vazio, o relatório poderá sugerir uma área pelo grupo; revise o resultado." persistent-hint />
          </v-col>
          <v-col cols="6" sm="3">
            <MoneyField v-model="form.custo" label="Custo" :hint="ajuda('custo')" />
          </v-col>
          <v-col cols="6" sm="3">
            <v-text-field
              v-model.number="form.margemPct"
              type="number" @wheel="semRolagemNoNumero"
              label="Margem"
              suffix="%"
              :min="0"
              :max="1000"
              :hint="margemDoGrupo != null ? `Padrão do grupo: ${margemDoGrupo}% — vazio usa esse valor, 0 vende pelo custo` : 'Ex.: 70 = 70%. Vazio = sem margem própria.'"
              persistent-hint
              variant="outlined"
              density="comfortable"
              @blur="clampMargem"
            />
          </v-col>
          <v-col cols="12" sm="6" class="d-flex align-center">
            <v-switch v-model="form.auto" label="Calcular venda automático" color="primary" inset hide-details />
          </v-col>
          <v-col cols="12" sm="6">
            <MoneyField v-model="form.vVendaPontual" label="V. Venda pontual" :disabled="form.auto" :hint="ajuda('vVendaPontual')" />
          </v-col>
          <v-col cols="12">
            <v-text-field :model-value="`R$ ${vVenda.toFixed(2).replace('.', ',')}`" label="V. Venda (calculado)" variant="outlined" density="comfortable" readonly bg-color="purple-lighten-5" />
          </v-col>


          <!-- exclusivo de transformação — é da BASE: define o que o produto é -->
          <template v-if="form.tipo === 'transformacao'">
            <v-col cols="12"><div class="product-form__subheading"><strong>Transformação</strong><span>Quantidade, unidade e receituário</span></div></v-col>
            <v-col cols="6" sm="4">
              <v-select v-model="form.precisao" :items="['EXATOS', 'APROXIMADOS']" label="Precisão" variant="outlined" density="comfortable" :hint="ajuda('precisao')" />
            </v-col>
            <v-col cols="6" sm="4">
              <v-text-field v-model.number="form.qtdTransf" type="number" @wheel="semRolagemNoNumero" label="Quantidade" variant="outlined" density="comfortable" :hint="ajuda('qtdTransf')" />
            </v-col>
            <v-col cols="12" sm="4">
              <v-select v-model="form.unidadeTransf" :items="UNIDADES_TR" label="Unidade" variant="outlined" density="comfortable" :hint="ajuda('unidadeTransf')" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="form.produtoReceituario" label="Produto receituário" variant="outlined" density="comfortable" :hint="ajuda('produtoReceituario')" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="form.refReceituario" label="Ref. receituário" variant="outlined" density="comfortable" :hint="ajuda('refReceituario')" />
            </v-col>
            <v-col cols="12">
              <v-text-field :model-value="validacaoQtd" label="Validação de quantidade (automática)" variant="outlined" density="comfortable" readonly bg-color="grey-lighten-4" />
            </v-col>
          </template>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- FISCAL — da LOJA: so aparece depois que o produto foi importado -->
    <v-card v-if="modoLoja" flat border rounded="lg" class="product-form__card mb-4">
      <v-card-title class="product-form__card-heading">
        <span class="product-form__icon"><v-icon icon="receipt_long" size="20" /></span>
        <span class="product-form__heading-copy"><strong>Fiscal</strong><small>Classificação e situação da fonte fiscal</small></span>
        <!--
          O estado vem ao lado do título de propósito: "cadastro salvo" e
          "fiscal resolvido" eram indistinguíveis, e a pessoa saía achando que
          tinha terminado. Quando falta fonte, o motivo aparece logo abaixo em
          português — não adianta dizer "pendente" sem dizer de quê.
        -->
        <v-chip
          v-if="estadoFiscal"
          size="small"
          label
          class="product-form__fiscal-status"
          :color="estadoFiscal.cor"
          :prepend-icon="estadoFiscal.icone"
        >
          {{ estadoFiscal.rotulo }}
        </v-chip>
      </v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col v-if="estadoFiscal && estadoFiscal.motivo" cols="12">
            <v-alert :type="estadoFiscal.tipo" variant="tonal" density="compact" class="mb-2">
              {{ estadoFiscal.motivo }}
              <template v-if="estadoFiscal.quemResolve">
                <br><strong>{{ estadoFiscal.quemResolve }}</strong>
              </template>
            </v-alert>
          </v-col>
          <v-col v-if="!isAdmin" cols="12">
            <v-alert type="info" variant="tonal" density="compact" class="mb-2">
              Os dados fiscais são definidos pelo administrador e calculados a partir do grupo.
              Trocar o grupo aqui recalcula os impostos automaticamente.
            </v-alert>
          </v-col>
          <v-col v-if="automaticFiscal" cols="12">
            <v-alert type="info" variant="tonal" density="compact" class="mb-2">
              Regra automática: {{ automaticFiscal.tributacaoSimples }} · CST {{ automaticFiscal.cstPisCofins }} ·
              Simples {{ automaticFiscal.aliquotaSimples.toFixed(2).replace('.', ',') }}% ·
              ICMS RE {{ automaticFiscal.icmsRe.toFixed(2).replace('.', ',') }}%
              <div v-if="automaticFiscal.baseFiscal" class="text-caption mt-1">{{ automaticFiscal.baseFiscal }}</div>
              <div v-if="fiscalClassification" class="text-caption mt-1">
                Fonte: {{ fiscalClassification.origem === 'plu_balanca' ? 'PLU do código de balança' : fiscalClassification.origem }}
              </div>
            </v-alert>
          </v-col>
          <v-col cols="12" sm="6"><v-text-field v-model="form.ncm" label="NCM (automático quando encontrado)" variant="outlined" density="comfortable" :loading="loadingFiscal" :readonly="!isAdmin || !!fiscalClassification?.ncm" :bg-color="(!isAdmin || fiscalClassification?.ncm) ? 'grey-lighten-4' : undefined" :hint="ajuda('ncm')" /></v-col>
          <v-col cols="12" sm="6"><v-text-field v-model="form.cest" label="Código CEST" variant="outlined" density="comfortable" :readonly="!isAdmin" :bg-color="!isAdmin ? 'grey-lighten-4' : undefined" :hint="ajuda('cest')" /></v-col>
          <v-col cols="12" sm="6"><v-text-field v-model="form.categoria" label="Categoria" variant="outlined" density="comfortable" :readonly="!isAdmin" :bg-color="!isAdmin ? 'grey-lighten-4' : undefined" :hint="ajuda('categoria')" /></v-col>
          <v-col cols="12" sm="6"><v-text-field :model-value="automaticFiscal?.cstPisCofins ?? form.cstPisCofins" label="CST PIS/COFINS (automático)" variant="outlined" density="comfortable" readonly bg-color="grey-lighten-4" /></v-col>
          <v-col cols="6" sm="4"><v-text-field :model-value="form.cstReforma || '—'" label="CST reforma" variant="outlined" density="comfortable" readonly bg-color="grey-lighten-4" /></v-col>
          <v-col cols="6" sm="4"><v-text-field :model-value="form.cClassTrib || '—'" label="cClassTrib" variant="outlined" density="comfortable" readonly bg-color="grey-lighten-4" /></v-col>
          <v-col cols="6" sm="4"><v-text-field :model-value="form.aliquotaIbs" label="IBS %" variant="outlined" density="comfortable" readonly bg-color="grey-lighten-4" /></v-col>
          <v-col cols="6" sm="4"><v-text-field :model-value="form.aliquotaCbs" label="CBS %" variant="outlined" density="comfortable" readonly bg-color="grey-lighten-4" /></v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- PROMOÇÃO — da LOJA (UX-05; vira tela do gerente no UX-06) -->
    <v-card v-if="modoLoja && form.tipo === 'revenda'" flat border rounded="lg" class="product-form__card mb-4">
      <v-card-title class="product-form__card-heading">
        <span class="product-form__icon"><v-icon icon="sell" size="20" /></span>
        <span class="product-form__heading-copy"><strong>Promoção</strong><small>Condições e período de oferta</small></span>
      </v-card-title>
      <v-card-text>
        <v-row dense>
          <v-col cols="12">
            <v-btn-toggle v-model="form.promoTipo" mandatory color="primary" divided density="comfortable" class="product-form__toggle">
              <v-btn value="nenhum">Sem promoção</v-btn>
              <v-btn value="valor">Valor fixo</v-btn>
              <v-btn value="desconto">Desconto %</v-btn>
            </v-btn-toggle>
          </v-col>
          <template v-if="form.promoTipo !== 'nenhum'">
            <v-col v-if="form.promoTipo === 'valor'" cols="6" sm="4">
              <MoneyField v-model="form.promoValor" label="Valor promo" />
            </v-col>
            <v-col v-if="form.promoTipo === 'desconto'" cols="6" sm="4">
              <v-text-field v-model.number="form.promoDescontoPct" type="number" @wheel="semRolagemNoNumero" label="Desconto %" variant="outlined" density="comfortable" />
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
      </v-card-text>
    </v-card>

    <div class="product-form__actions">
      <v-btn variant="text" to="/">Cancelar</v-btn>
      <v-btn color="primary" :loading="saving" prepend-icon="save" @click="salvar(false)">Salvar produto</v-btn>
    </div>

    <!-- leitor de código de barras pela câmera (laser USB/BT já digita direto no campo) -->
    <BarcodeScanner v-model:open="scanOpen" @scanned="onScanned" />
  </div>
</template>

<style scoped>
.product-form {
  max-width: 860px;
  margin: 0 auto;
  padding-bottom: var(--cx-space-8);
}
.product-form__intro {
  display: flex;
  align-items: flex-start;
  gap: var(--cx-space-2);
  margin-bottom: var(--cx-space-6);
}
.product-form__intro > div {
  min-width: 0;
  padding-top: var(--cx-space-1);
}
.product-form__intro h1 {
  margin: var(--cx-space-1) 0;
  color: var(--cx-ink);
  font-size: var(--cx-text-title);
  font-weight: 750;
  letter-spacing: -0.025em;
  line-height: 1.25;
}
.product-form__intro p {
  margin: 0;
  color: var(--cx-ink-soft);
  font-size: var(--cx-text-sm);
  line-height: 1.5;
}
.product-form__notice {
  background: var(--cx-surface-sunken);
}
.product-form__card-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--cx-space-3);
  min-height: 84px;
  padding: var(--cx-space-4) var(--cx-space-5);
  border-bottom: 1px solid var(--cx-line-soft);
  white-space: normal;
}
.product-form__icon {
  display: inline-flex;
  flex: 0 0 40px;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--cx-r-md);
  background: var(--cx-brand-wash);
  color: var(--cx-brand);
}
.product-form__heading-copy {
  display: flex;
  flex: 1 1 180px;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}
.product-form__heading-copy strong {
  color: var(--cx-ink);
  font-size: var(--cx-text-md);
  font-weight: 700;
  line-height: 1.35;
}
.product-form__heading-copy small {
  color: var(--cx-ink-soft);
  font-size: var(--cx-text-xs);
  line-height: 1.4;
}
.product-form__fiscal-status {
  margin-left: auto;
}
.product-form__card :deep(.v-card-text) {
  padding: var(--cx-space-5);
}
.product-form__subheading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--cx-space-1) var(--cx-space-3);
  margin: var(--cx-space-3) 0 var(--cx-space-2);
  padding-top: var(--cx-space-5);
  border-top: 1px solid var(--cx-line-soft);
}
.product-form__subheading strong {
  color: var(--cx-ink);
  font-size: var(--cx-text-sm);
  font-weight: 700;
}
.product-form__subheading span {
  color: var(--cx-ink-soft);
  font-size: var(--cx-text-xs);
}
.product-form__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--cx-space-2);
  padding-top: var(--cx-space-2);
}
.dropzone {
  border: 1px dashed var(--cx-line);
  border-radius: var(--cx-r-lg);
  padding: 22px 16px;
  text-align: center;
  background: var(--cx-surface-sunken);
  transition: border-color 140ms var(--cx-ease), background 140ms var(--cx-ease);
}
.dropzone:focus-within,
.dropzone:hover {
  border-color: var(--cx-brand);
  background: var(--cx-brand-wash);
}
.dropzone--full {
  padding: 12px;
}
@media (max-width: 600px) {
  .product-form__intro {
    margin-bottom: var(--cx-space-5);
  }
  .product-form__card-heading {
    gap: var(--cx-space-2);
    padding: var(--cx-space-4);
  }
  .product-form__card :deep(.v-card-text) {
    padding: var(--cx-space-4);
  }
  .product-form__toggle {
    display: flex;
    width: 100%;
    height: auto;
  }
  .product-form__toggle :deep(.v-btn) {
    flex: 1 1 0;
    min-width: 0;
    height: auto;
    min-height: 44px;
    padding: var(--cx-space-2);
    white-space: normal;
  }
  .product-form__toggle :deep(.v-btn__content) {
    white-space: normal;
    text-align: center;
    line-height: 1.2;
  }
  .product-form__actions :deep(.v-btn) {
    flex: 1 1 auto;
    min-height: 48px;
  }
}
/*
 * A frase de "como se compra" e longa por natureza — ela repete a descricao
 * duas vezes. Uma linha so, mas com fonte menor para caber o caso comum, e
 * sem reticencias: o que passar rola na horizontal em vez de sumir.
 */
.como-se-compra :deep(input) {
  font-size: 0.82rem;
  text-overflow: clip;
}
</style>
