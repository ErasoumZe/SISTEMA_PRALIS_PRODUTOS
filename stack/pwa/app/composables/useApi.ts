import type { ProductSchemas, ProductRequests, AdminSchemas, VendasSchemas, VendasDePara, VendasUnicos, VendasRanking, VendasGerentes, VendasPdv, VendasAbc, VendasPulso } from '@pralis/shared';
import type { VendasLista, MetasSchemas } from '@pralis/shared';

type Product = ProductSchemas.ProductEntity;
type Dashboard = AdminSchemas.Dashboard;
type AdminUser = AdminSchemas.AdminUser;
export type VendasReport = VendasSchemas.VendasReport;
export type VendasReportQuery = VendasSchemas.VendasReportQuery;
export type VendasRankingResposta = VendasRanking.VendasRanking;
export type DetalhePdv = VendasPdv.DetalhePdv;
export type DetalhePdvQuery = VendasPdv.DetalhePdvQuery;
export type VendasRankingQuery = VendasRanking.VendasRankingQuery;
export type RelatorioGerentes = VendasGerentes.Gerentes;
export type RelatorioGerentesQuery = VendasGerentes.GerentesQuery;
export type RelatorioGerentesAreas = VendasGerentes.GerentesAreas;
export type RelatorioGerentesAreasQuery = VendasGerentes.GerentesAreasQuery;
export type RelatorioGerentesHoras = VendasGerentes.GerentesHoras;
export type MetasTurno = MetasSchemas.Metas;
export type MetasTurnoQuery = MetasSchemas.MetasQuery;
export type GerarMatrizBody = MetasSchemas.GerarMatrizBody;
export type GerarMatrizResult = MetasSchemas.GerarMatrizResult;
export type ItemRanking = VendasRanking.ItemRanking;
export type AbcProdutos = VendasAbc.AbcProdutos;
export type AbcProdutosQuery = VendasAbc.AbcProdutosQuery;
export type ListaVendasQuery = VendasLista.ListaVendasQuery;
export type ListaVendas = VendasLista.ListaVendas;
export type VendaResumo = VendasLista.VendaResumo;
export type VendaDetalheQuery = VendasLista.VendaDetalheQuery;
export type VendaDetalhe = VendasLista.VendaDetalhe;
export type Pulso = VendasPulso.Pulso;
export type DeParaLista = VendasDePara.DeParaLista;
export type DeParaQuery = VendasDePara.DeParaQuery;
export type VincularBody = VendasDePara.VincularBody;
export type ProdutosUnicos = VendasUnicos.ProdutosUnicos;
export type ProdutosUnicosQuery = VendasUnicos.ProdutosUnicosQuery;

/** Onde cada produto caiu na reconciliação do código de cadastro. */
export type BaldeCodigo =
  | 'ja-correto'
  | 'exato'
  /** O código está escrito no campo de barras, mas o de-para não o confirma. */
  | 'barras-tem-codigo'
  | 'conflito-sia'
  | 'disputado'
  | 'fora-do-sia'
  | 'novo';

/** Os baldes que podem ser adotados em lote — os de código lido, não sugerido. */
export type BaldeEmLote = 'exato' | 'barras-tem-codigo';

export interface PessoaPermissao {
  userId: string;
  nome: string;
  email: string;
  role: 'admin' | 'user';
  loja: string | null;
  ativo: boolean;
  /** O admin principal: enxerga tudo e ninguém altera. */
  adminRaiz: boolean;
  /** Quem está olhando pode mexer nesta pessoa? */
  gerenciavel: boolean;
  /** Por que não, quando não. */
  motivo: string | null;
  telas: string[];
}

export interface PainelDePermissoes {
  telas: Array<{
    id: string; titulo: string; subtitulo: string; path: string;
    secao: string; icone: string; foraDoMenu?: boolean; sempreLiberada?: boolean;
  }>;
  secoes: string[];
  sempreLiberadas: string[];
  pessoas: PessoaPermissao[];
}

/** Um produto do SIA que casou pelo código de barras. */
export interface CandidatoCodigo {
  loja: string;
  coditem: string;
  descricao: string;
  /** Só nas sugestões por nome: 0..100 de parecença. */
  semelhanca?: number;
}

export interface ItemCodigoCadastro {
  productId: string;
  loja: string;
  nome: string;
  codigoBarras: string | null;
  codigoAtual: string | null;
  balde: BaldeCodigo;
  codigoProposto: string | null;
  motivo: string;
  candidatos: CandidatoCodigo[];
}

export interface PreviaCodigoCadastro {
  resumo: Record<BaldeCodigo, number>;
  /** De onde sai o próximo código cunhado. */
  teto: number;
  tetoDe: string;
  paresSia: number;
  /** A planilha MIX só entra no teto — quem decide o código é o SIA. */
  planilha: { estado: string; teto: number; linhas: number };
  itens: ItemCodigoCadastro[];
  confirmacao: string;
  loteMaximo: number;
}

/** Prévia exclusiva: somente o código de barras liga um cadastro da Giulia ao SIA. */
export interface PreviaGiuliaSia {
  propostas: Array<{
    produto: { id: string; loja: string; nome: string; codigoBarras: string | null; codigoInterno: string | null };
    situacao: 'conciliar-sia' | 'novo-codigo' | 'pendente' | 'conflito-sia';
    codigoProposto: string | null;
    candidatos: Array<{ loja: string; coditem: string; descricao: string; ativo: string }>;
    motivo: string;
  }>;
  linhasCatalogoSia: number; ultimoSiaAtivo: number; maiorBanco: number; teto: number;
  resumo: { 'conciliar-sia': number; 'novo-codigo': number; pendente: number; 'conflito-sia': number };
  confirmacao: string; loteMaximo: number;
}

/** Conferência de uma exportação do SIA antes de substituir o de-para. */
export interface ResumoDePara {
  loja: string;
  arquivo: string;
  linhas: number;
  semBarras: number;
  semDadosBalanca: number;
  /** Quantas linhas a loja tem hoje — o que seria substituído. */
  atuais: number;
  barrasAmbiguas: Array<{ chave: string; coditens: string[] }>;
  coditensRepetidos: string[];
  /** Menor e maior coditem do CATÁLOGO — a entrega não entra na conta. */
  faixa: { min: number; max: number } | null;
  /** Linhas de entrega, que ficam de fora do de-para. */
  entrega: number;
  confirmacao: string;
}

/** Por que um produto não recebeu custo da base de discriminação. */
export type MotivoSemCusto = 'sem-lancamento' | 'nome-ambiguo-no-cadastro' | 'custo-ilegivel' | 'ja-esta-certo';

export interface PropostaCusto {
  productId: string;
  nome: string;
  custoAtual: number | null;
  custoNovo: number | null;
  /** O valor unitário da nota, antes de virar custo de embalagem. */
  custoUnitario: number | null;
  /** Por quanto o unitário foi multiplicado. */
  qtCad: number;
  /** De qual compra veio: linha e data. */
  fonte: string | null;
  motivo?: MotivoSemCusto;
}

export interface PreviaCustoMer {
  estado: 'ok' | 'sem-destino' | 'sem-coluna' | 'falhou';
  truncada: boolean;
  faltando: string[];
  erro?: string;
  /** Em que linha da aba o cabeçalho foi encontrado. */
  linhaCabecalho: number | null;
  lancamentos: number;
  lancamentosDescartados: number;
  comCusto: number;
  semCusto: Record<MotivoSemCusto, number>;
  amostra: PropostaCusto[];
  confirmacao: string;
  loteMaximo: number;
}

/** Por que uma linha da planilha não virou cadastro. */
export type MotivoRecusaCarga =
  | 'codigo-invalido' | 'codigo-repetido-na-planilha' | 'sem-nome'
  | 'situacao-desconhecida' | 'unidade-desconhecida' | 'sem-id-de-grupo';

export interface DecisaoCarga {
  linha: number;
  codigo: string;
  nome: string;
  acao: 'importar' | 'recusar';
  motivo?: MotivoRecusaCarga;
  produto?: Record<string, unknown>;
}

/** Um produto do jeito que entraria no cadastro. */
export interface ProdutoDaCarga {
  codigoInterno: string;
  nome: string;
  codigoBarras: string | null;
  medidaBase: string;
  tipo: 'revenda' | 'transformacao';
  status: 'ativo' | 'inativo';
  grupo: string | null;
  grupoId: string;
  estoqueMin: number | null;
  estoqueMax: number | null;
  custo: number | null;
  precoVenda: number | null;
}

export interface PreviaCarga {
  estado: 'ok' | 'sem-destino' | 'coluna-mudou' | 'falhou';
  erro?: string;
  /** Colunas cujo título saiu do lugar. Havendo uma, a carga não roda. */
  trocadas: Array<{ coluna: string; esperado: string; encontrado: string }>;
  truncada: boolean;
  linhasLidas: number;
  linhasSemNome: number;
  importar: number;
  ativos: number;
  inativos: number;
  comBarras: number;
  recusas: Record<MotivoRecusaCarga, number>;
  recusadas: DecisaoCarga[];
  barrasRepetidas: Array<{ codigoBarras: string; codigos: string[] }>;
  porGrupo: Array<{ grupoId: string; grupo: string | null; tipo: 'revenda' | 'transformacao'; quantidade: number }>;
  /** Quantos cadastros da Base seriam apagados antes da carga. */
  apagar: number;
  /** Quantos produtos da Base já sabem em que linha da planilha moram. */
  vinculados: number;
  confirmacaoVinculo: string;
  amostra: ProdutoDaCarga[];
  confirmacao: string;
}

/** Uma linha de fonte dentro do grupo, como veio do staging. */
export interface ItemUnificacao {
  fonte: string; loja: string; codInterno: string | null; codBarras: string | null;
  nome: string | null; ativo: boolean | null; grupo: string | null;
  custo: string | null; venda: string | null; ncm: string | null; cst: string | null;
  raw: Record<string, string> | null;
}

export interface CandidatoUnificacao {
  nome: string; nomeDe: string; grupo: string | null; grupoDe: string | null;
  custo: number | null; custoDe: string | null; venda: number | null; vendaDe: string | null;
  ativo: boolean;
  fiscalLi: { ncm: string | null; cst: string | null; csosn: string | null; aliqEcf: string | null; reducao: number | null } | null;
  fiscalTnp: { ncm: string | null; cst: string | null; icmsEfetivo: number | null } | null;
}

export interface GrupoUnificacao {
  id: string; chave: string; motivo: string; fontes: string[]; lojas: string[];
  nome: string; grupo: string | null; grupoManual: string | null; ativo: boolean;
  candidato: CandidatoUnificacao; itens: ItemUnificacao[];
  flagNomesDivergentes: boolean; flagSemFiscalTnp: boolean; flagSemBarras: boolean;
  flagBarrasConflitante: boolean; flagSemGrupo: boolean; flagJaNoPralis: boolean;
  decisao: string | null; decididoPor: string | null;
}

export interface PaginaGrupos {
  total: number; pagina: number; tamanho: number; paginas: number; grupos: GrupoUnificacao[];
}

export interface TotaisUnificacao {
  grupos: number; porMotivo: Record<string, number>; jaNoPralis: number; aCriar: number;
  semFiscalTnp: number; semGrupo: number; nomesDivergentes: number; barrasConflitante: number;
  pendentes: number; decididos: number;
  /**
   * `decididos` soma as duas naturezas; estas duas as separam. Um descarte
   * (`não é o mesmo`, `ignorado`) tira o grupo da fila sem criar nada, então
   * contá-lo junto com a unificação faz a tela prometer cadastro que ninguém
   * mandou criar.
   */
  unificados: number; descartados: number;
}

/**
 * O retrato das fontes carregadas. A Central usa só a contagem por fonte, e por
 * um motivo específico: o universo da tela são as vendas dos PDVs nos últimos
 * 12 meses, que chegam pelo robô. Se o robô parar, a Central fica vazia sem
 * nada quebrar — e uma tela vazia sem explicação já custou uma semana aqui.
 */
export interface StagingUnificacao {
  carregado: boolean;
  carregadoEm: string | null;
  total: number;
  fontes: Array<{ fonte: string; linhas: number }>;
}

export interface FiltrosUnificacao {
  filtro?: string; loja?: string; status?: string; revisar?: boolean;
  semFiscalTnp?: boolean; semGrupo?: boolean; q?: string; decisao?: string;
  /**
   * Só o que já vendeu ao menos uma vez. Vai como `undefined` quando desligado
   * (nunca `false`): o servidor coage qualquer texto para `true`, então mandar
   * "false" ligaria o recorte sem querer.
   */
  somenteVendidos?: boolean;
  pagina?: number; tamanho?: number;
}

export interface HistoricoNomeProduto {
  id: string;
  productId: string;
  loja: string;
  codigo: string;
  codigoInterno: string | null;
  nomeAnterior: string;
  nomeNovo: string;
  alteradoPorNome: string | null;
  alteradoEm: string;
}
/** O que um lote de "criar todos os que faltam" devolve. */
export interface LoteFaltantes {
  selecionados: number;
  /** Produto que NÃO existia e passou a existir. */
  criados: number;
  /** Já estava no Pralis e foi completado em vez de criado — não é erro. */
  pulados: number;
  falhas: number;
  /** Quantos ainda faltam depois deste lote. */
  restantes: number;
}

export interface GroupTaxRule {
  grupo: string;
  cstPisCofins: string;
  tributacaoSimples: string;
  aliquotaSimples: number;
  icmsRe: number;
  baseFiscal: string;
  /**
   * Margem padrão do grupo, como FRAÇÃO (0.2 = 20%). Nula na maioria: hoje
   * só 3 dos 76 grupos têm margem definida na planilha.
   */
  margemPadrao: number | null;
}
export interface FiscalClassification extends GroupTaxRule {
  ncm: string | null;
  codigoFiscal: string | null;
  produtoFiscal: string | null;
  cstReforma: string | null;
  cClassTrib: string | null;
  aliquotaIbs: number | null;
  aliquotaCbs: number | null;
  origem: 'produto' | 'plu_balanca' | 'grupo';
}

/** Estado do espelhamento do produto na planilha (etapa 1: só a BASE). */
export type SheetSyncStatus = 'synced' | 'failed' | 'pending' | 'disabled' | 'skipped' | 'misconfigured';

// ---- reconciliação banco x planilha (somente leitura) ----
export type EstadoReconciliacao =
  | 'ok' | 'desligado' | 'sem-destino' | 'sem-credencial' | 'sem-aba' | 'sem-coluna' | 'falhou';

export interface ResumoReconciliacao {
  produtosNoBanco: number;
  linhasComProduto: number;
  linhasComId: number;
  semLinhaNaPlanilha: number;
  linhasOrfas: number;
  linhasSemId: number;
  nomeDivergente: number;
  limite: number;
  /** Alguma lista foi cortada; as contagens acima continuam inteiras. */
  truncado: boolean;
}

export interface Reconciliacao {
  estado: EstadoReconciliacao;
  mensagem: string;
  spreadsheetId: string;
  aba: string;
  colunaId: string | null;
  colunaNome: string | null;
  resumo: ResumoReconciliacao;
  semLinhaNaPlanilha: Array<{ produtoId: string; codigo: string; codigoInterno: string | null; nome: string }>;
  linhasOrfas: Array<{ linha: number; id: string; nome: string }>;
  linhasSemId: Array<{ linha: number; nome: string }>;
  nomeDivergente: Array<{ produtoId: string; linha: number; nomeNoBanco: string; nomeNaPlanilha: string }>;
}

export type TipoConfrontoHistorico = 'barras-exatas' | 'nome-exato' | 'revisar' | 'sem-par';
export interface PreviaDuplicadosHistoricos {
  resumo: Record<TipoConfrontoHistorico, number>;
  tetoAtual: number;
  confirmacao: string;
  itens: Array<{
    legado: { id: string; codigoInterno: string; nome: string; codigoBarras: string | null };
    tipo: TipoConfrontoHistorico;
    candidato: { id: string; codigoInterno: string; nome: string; codigoBarras: string | null } | null;
    semelhanca: number | null;
  }>;
}

/**
 * Cliente da API (envelope { message, data, details }). Tipado pelos schemas do @pralis/shared.
 */
export function useApi() {
  const apiBase = useRuntimeConfig().public.apiBase as string;
  const base = { baseURL: apiBase, credentials: 'include' as const };
  const unwrap = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data);

  return {
    // `loja` só tem efeito para admin (visualizar outro catálogo); ignorado p/ usuário comum
    listProducts: (q?: string, loja?: string, somenteVendidos?: boolean) =>
      unwrap($fetch<{ data: Product[] }>('/products', {
        ...base,
        query: {
          ...(q ? { q } : {}),
          ...(loja ? { loja } : {}),
          ...(somenteVendidos ? { somenteVendidos: 'true' } : {}),
        },
      })),

    listBase: (q?: string) =>
      unwrap($fetch<{ data: Product[] }>('/products/base', { ...base, query: q ? { q } : undefined })),

    importBase: (baseIds: string[]) =>
      unwrap($fetch<{ data: { imported: number; skipped: number; espelhoLoja: string } }>('/products/import', { ...base, method: 'POST', body: { baseIds } })),

    historicoNomes: () =>
      unwrap($fetch<{ data: HistoricoNomeProduto[] }>('/admin/produtos/historico-nomes', { ...base })),

    getProduct: (id: string) =>
      unwrap($fetch<{ data: Product }>(`/products/${id}`, { ...base })),

    // devolve o envelope inteiro: `details.sheetSync` diz se o espelho na
    // planilha ficou 'synced', 'failed', 'disabled' ou 'skipped'
    createProduct: (body: ProductRequests.CreateProductRequest) =>
      $fetch<{ data: Product; message: string; details: { sheetSync?: SheetSyncStatus } | null }>(
        '/products',
        { ...base, method: 'POST', body },
      ),

    // devolve o envelope inteiro, igual ao create: `details.sheetSync` diz se
    // a planilha acompanhou a edição
    updateProduct: (id: string, body: ProductRequests.UpdateProductRequest) =>
      $fetch<{ data: Product; message: string; details: { sheetSync?: SheetSyncStatus } | null }>(
        `/products/${id}`,
        { ...base, method: 'PUT', body },
      ),

    deleteProduct: (id: string) =>
      $fetch(`/products/${id}`, { ...base, method: 'DELETE' }),
    deleteProductsBatch: (ids: string[], confirmacao: string) =>
      $fetch<{ data: { excluidos: string[]; falhas: Array<{ id: string; erro: string }> } }>('/products/excluir-lote', { ...base, method: 'POST', body: { ids, confirmacao } }),

    uploadFoto: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return $fetch<{ data: { url: string } }>('/files', { ...base, method: 'POST', body: fd }).then((r) => r.data.url);
    },

    /**
     * Busca EXATA por código de barras — não é o `q`, que procura em nome,
     * marca e código do sistema. Era essa a causa do aviso de duplicado não
     * achar o duplicado.
     */
    /** Lista com filtros; `somenteVendidos` esconde o que a loja nunca vendeu. */
    listProductsFiltrado: (query: Record<string, string | boolean>) =>
      unwrap($fetch<{ data: Product[] }>('/products', { ...base, query })),

    findByCodigoBarras: (codigoBarras: string) =>
      unwrap($fetch<{ data: Product[] }>('/products', { ...base, query: { codigoBarras } })),

    /** Quem enxerga cada tela — a grade inteira numa chamada só. */
    permissoesPainel: () =>
      unwrap($fetch<{ data: PainelDePermissoes }>('/admin/permissoes', { ...base })),

    /** Liga ou desliga UMA tela para UMA pessoa. */
    permissoesAlternar: (body: { userId: string; telaId: string; permitido: boolean }) =>
      unwrap($fetch<{ data: { userId: string; telas: string[] } }>(
        '/admin/permissoes/alternar',
        { ...base, method: 'POST', body },
      )),

    duplicadosHistoricosPrevia: () =>
      unwrap($fetch<{ data: PreviaDuplicadosHistoricos }>('/admin/produtos/duplicados-historicos/previa', { ...base })),
    duplicadosHistoricosUnificar: (body: {
      perdedorId: string; vencedorId: string; codigoPerdedorEsperado: string; codigoVencedorEsperado: string; confirmacao: string;
    }) => $fetch('/admin/produtos/duplicados-historicos/unificar', { ...base, method: 'POST', body }),
    duplicadosHistoricosUnificarNomesExatos: (body: { totalEsperado: number; confirmacao: string }) =>
      $fetch<{ data: { aplicados: number; falhas: Array<{ codigo: string; erro: string }> } }>('/admin/produtos/duplicados-historicos/unificar-nomes-exatos', { ...base, method: 'POST', body }),
    duplicadosHistoricosUnificarRevisados: (body: { itens: Array<{
      perdedorId: string; vencedorId: string; codigoPerdedorEsperado: string; codigoVencedorEsperado: string; confirmacao: string;
    }> }) => $fetch<{ data: { aplicados: number; falhas: Array<{ codigo: string; erro: string }> } }>('/admin/produtos/duplicados-historicos/unificar-revisados', { ...base, method: 'POST', body }),

    listGroupTaxRules: () =>
      unwrap($fetch<{ data: GroupTaxRule[] }>('/apoio/grupos-fiscais', { ...base })),

    classifyFiscal: (grupo: string, codigoBarras?: string) =>
      unwrap($fetch<{ data: FiscalClassification }>('/apoio/classificacao-fiscal', {
        ...base, query: { grupo, ...(codigoBarras ? { codigoBarras } : {}) },
      })),

    // ---- vendas ----
    // O backend decide a loja: admin informa, usuario de loja recebe a dele.
    vendasReport: (query: VendasReportQuery) =>
      unwrap($fetch<{ data: VendasReport }>('/vendas/relatorio', { ...base, query })),

    /** Há quanto tempo cada fonte de vendas não recebe lote do robô. */
    vendasPulso: () => unwrap($fetch<{ data: Pulso }>('/vendas/pulso', { ...base })),

    /** Produtos de cada classe da curva ABC, com dados do cadastro. */
    vendasCurvaAbc: (query: AbcProdutosQuery) =>
      unwrap($fetch<{ data: AbcProdutos }>('/vendas/curva-abc', { ...base, query })),

    /** Ranking de vendas por produto, grupo, setor ou PDV. */
    vendasRanking: (query: VendasRankingQuery) =>
      unwrap($fetch<{ data: VendasRankingResposta }>('/vendas/ranking', { ...base, query })),
    relatorioGerentes: (query: RelatorioGerentesQuery) =>
      unwrap($fetch<{ data: RelatorioGerentes }>('/vendas/gerentes', { ...base, query })),
    acessoGerentes: () =>
      unwrap($fetch<{ data: { lojas: Array<'TNP' | 'LI'> } }>('/vendas/gerentes/acesso', { ...base })),
    plantaGerentes: () =>
      $fetch<Blob>('/vendas/gerentes/planta', { ...base, query: { loja: 'TNP' }, responseType: 'blob', cache: 'no-store' }),
    relatorioGerentesAreas: (query: RelatorioGerentesAreasQuery) =>
      unwrap($fetch<{ data: RelatorioGerentesAreas }>('/vendas/gerentes/areas', { ...base, query })),
    relatorioGerentesHoras: (query: VendasGerentes.GerentesHorasQuery) =>
      unwrap($fetch<{ data: RelatorioGerentesHoras }>('/vendas/gerentes/horas', { ...base, query })),

    /** Metas por turno: objetivo, projeção, atingido e diferença. Resposta só para admin. */
    metasTurno: (query: MetasTurnoQuery) =>
      unwrap($fetch<{ data: MetasTurno }>('/vendas/metas', { ...base, query })),
    gerarMatrizMetas: (body: GerarMatrizBody) =>
      unwrap($fetch<{ data: GerarMatrizResult }>('/vendas/metas/matriz', { ...base, method: 'POST', body })),

    vendasPdvDetalhe: (query: DetalhePdvQuery) =>
      unwrap($fetch<{ data: DetalhePdv }>('/vendas/pdv/detalhe', { ...base, query })),

    /** Vendas do período, uma por cupom. A tela relê a cada poucos segundos. */
    vendasLista: (query: ListaVendasQuery) =>
      unwrap($fetch<{ data: ListaVendas }>('/vendas/lista', { ...base, query })),

    /** Os itens de um cupom, pelo ID original do ERP. */
    vendasVenda: (query: VendaDetalheQuery) =>
      unwrap($fetch<{ data: VendaDetalhe }>('/vendas/venda', { ...base, query })),

    /** Códigos do PDV sem produto no cadastro, com sugestões por semelhança. */
    vendasDePara: (query: DeParaQuery) =>
      unwrap($fetch<{ data: DeParaLista }>('/vendas/de-para', { ...base, query })),

    /** Confirma (ou desfaz, com productId nulo) o vínculo. */
    vincularDePara: (body: VincularBody) =>
      $fetch('/vendas/de-para', { ...base, method: 'POST', body }),

    /** Uma linha por produto vendido no período. */
    produtosUnicos: (query: ProdutosUnicosQuery) =>
      unwrap($fetch<{ data: ProdutosUnicos }>('/vendas/produtos-unicos', { ...base, query })),

    /**
     * URL do CSV do período INTEIRO. É link direto (não fetch) para o
     * navegador baixar o arquivo com o nome que o servidor manda.
     */
    produtosUnicosCsvUrl: (query: Record<string, string>) =>
      `${base.baseURL}/vendas/produtos-unicos.csv?${new URLSearchParams(query).toString()}`,

    // ---- Central de Produtos (unificação) ----
    /** Recarrega as fontes e reagrupa. Não toca no catálogo vivo. */
    unificacaoCarregar: () =>
      $fetch('/admin/unificacao/carregar', { ...base, method: 'POST' }),
    /**
     * O cabeçalho da Central. Recebe o recorte dos vendidos para os KPIs
     * contarem o MESMO universo da lista que aparece logo abaixo deles.
     */
    unificacaoHealth: (query: { somenteVendidos?: boolean } = {}) =>
      unwrap($fetch<{ data: { totais: TotaisUnificacao; staging: StagingUnificacao } }>(
        '/admin/unificacao/health', { ...base, query },
      )),
    /** Os filtros vão para o SERVIDOR: a tela nunca peneira 4.300 no navegador. */
    unificacaoGrupos: (query: FiltrosUnificacao) =>
      unwrap($fetch<{ data: PaginaGrupos }>('/admin/unificacao/grupos', { ...base, query })),
    unificacaoUnificar: (id: string, opcoes: { forcar?: boolean; nome?: string } = {}) =>
      $fetch(`/admin/unificacao/grupos/${id}/unificar`, { ...base, method: 'POST', body: opcoes }),
    unificacaoMarcar: (id: string, acao: 'nao_e_o_mesmo' | 'ignorado') =>
      $fetch(`/admin/unificacao/grupos/${id}/marcar`, { ...base, method: 'POST', body: { acao } }),
    unificacaoReabrir: (id: string) =>
      $fetch(`/admin/unificacao/grupos/${id}/reabrir`, { ...base, method: 'POST' }),
    unificacaoDefinirGrupo: (id: string, grupo: string) =>
      $fetch(`/admin/unificacao/grupos/${id}/grupo`, { ...base, method: 'PATCH', body: { grupo } }),
    /** Quantos grupos ainda cabem no lote automático (mesmo código de barras). */
    unificacaoAutoPendentes: () =>
      unwrap($fetch<{ data: { total: number } }>(
        '/admin/unificacao/auto-unificar/pendentes', { ...base },
      )),
    unificacaoAutoUnificar: (limite = 25) =>
      unwrap($fetch<{ data: { selecionados: number; concluidos: number; falhas: number } }>(
        '/admin/unificacao/auto-unificar', { ...base, method: 'POST', body: { limite } },
      )),

    /**
     * Quantos produtos o "criar todos os que faltam" criaria com os filtros de
     * agora. A tela precisa do número ANTES de confirmar — sem ele o clique é
     * no escuro, e pode ser 3 ou 3.000 cadastros.
     */
    unificacaoFaltantesPendentes: (filtros: FiltrosUnificacao = {}) =>
      unwrap($fetch<{ data: { total: number } }>(
        '/admin/unificacao/criar-faltantes/pendentes', { ...base, query: filtros },
      )),
    /**
     * Um lote de criação em massa. A tela repete enquanto sobrar `restantes`:
     * cada criação escreve na planilha, e mandar milhares numa chamada só
     * estouraria o tempo da requisição e a cota do Google.
     */
    unificacaoCriarFaltantes: (filtros: FiltrosUnificacao = {}, limite = 100) =>
      unwrap($fetch<{ data: LoteFaltantes }>(
        '/admin/unificacao/criar-faltantes',
        { ...base, method: 'POST', body: { ...filtros, limite } },
      )),

    /**
     * Divergências entre o catálogo do banco e a planilha. SOMENTE LEITURA —
     * não existe rota irmã de "corrigir", e é de propósito.
     */
    produtosReconciliacao: (limite?: number) =>
      unwrap($fetch<{ data: Reconciliacao }>('/admin/produtos/reconciliacao', {
        ...base, query: limite ? { limite } : undefined,
      })),

    // ---- código de cadastro × planilha MIX ----
    /**
     * Prévia da reconciliação. NÃO grava: dá para abrir, ler e fechar. A
     * planilha MIX é lida, nunca escrita.
     */
    codigoCadastroPrevia: () =>
      unwrap($fetch<{ data: PreviaCodigoCadastro }>('/admin/produtos/codigo-cadastro/previa', { ...base })),

    /**
     * Adota um balde inteiro de uma vez. Só os dois em que o código é um número
     * lido — nunca os que dependem de semelhança de nome.
     */
    codigoCadastroAdotarExatos: (confirmacao: string, balde: BaldeEmLote = 'exato') =>
      unwrap($fetch<{ data: { aplicadas: number; conflitos: number; restantes: number } }>(
        '/admin/produtos/codigo-cadastro/adotar-exatos',
        { ...base, method: 'POST', body: { confirmacao, balde } },
      )),

    /**
     * Uma decisão, um produto: adotar um código do SIA ou cunhar novo.
     *
     * `codigoAtualEsperado` é o que a TELA mostrava. Vai junto de propósito:
     * sem ele, quem está com a tela velha aberta sobrescreve em silêncio quem
     * decidiu primeiro.
     */
    codigoCadastroDecidir: (body: {
      productId: string;
      codigo?: string;
      cunhar?: boolean;
      codigoAtualEsperado: string | null;
      confirmacao: string;
    }) =>
      unwrap($fetch<{ data: { codigo: string; fonte: string } }>(
        '/admin/produtos/codigo-cadastro/decidir',
        { ...base, method: 'POST', body },
      )),

    // ---- produtos da Giulia × SIA (somente código de barras) ----
    giuliaSiaPrevia: () =>
      unwrap($fetch<{ data: PreviaGiuliaSia }>('/admin/produtos/giulia-sia/previa', { ...base })),
    giuliaSiaAplicar: (confirmacao: string) =>
      unwrap($fetch<{ data: { aplicadas: number; conflitos: number; restantes: number } }>(
        '/admin/produtos/giulia-sia/aplicar', { ...base, method: 'POST', body: { confirmacao } },
      )),

    // ---- importar da planilha MIX para a Base ----
    /** Prévia da importação. NÃO cria nada. */
    cargaBasePrevia: () =>
      unwrap($fetch<{ data: PreviaCarga }>('/admin/produtos/importar-mix/previa', { ...base })),

    /**
     * Zera a Base e cria TODOS os produtos da planilha, numa transação só.
     * Não tem lote nem "continuar de onde parou": ou a Base inteira fica de
     * pé, ou nada muda.
     */
    cargaBaseImportar: (confirmacao: string) =>
      unwrap($fetch<{ data: { apagados: number; criados: number; ativos: number; inativos: number; vinculadas: number } }>(
        '/admin/produtos/importar-mix',
        { ...base, method: 'POST', body: { confirmacao }, timeout: 300_000 },
      )),

    /**
     * Carimba o identificador do produto nas linhas que já existem na planilha.
     * Não cria linha nenhuma e não toca em outra coluna.
     */
    cargaBaseVincular: (confirmacao: string) =>
      unwrap($fetch<{ data: {
        vinculadas: number; jaVinculadas: number; linhasSemProduto: number; produtosSemLinha: number;
        codigosRepetidos: Array<{ codigo: string; linhas: number[] }>;
      } }>(
        '/admin/produtos/importar-mix/vincular',
        { ...base, method: 'POST', body: { confirmacao }, timeout: 300_000 },
      )),

    // ---- de-para do SIA ----
    /**
     * Confere a exportação SEM gravar. É o equivalente ao script sem `--apply`.
     */
    deParaPrevia: (loja: string, arquivo: File) => {
      const fd = new FormData();
      fd.append('loja', loja);
      fd.append('file', arquivo);
      return unwrap($fetch<{ data: ResumoDePara }>('/admin/creare/depara/previa', { ...base, method: 'POST', body: fd }));
    },

    /** Substitui o de-para da loja inteiro (só o catálogo; entrega fica de fora). */
    deParaAplicar: (loja: string, arquivo: File, confirmacao: string) => {
      const fd = new FormData();
      fd.append('loja', loja);
      fd.append('confirmacao', confirmacao);
      fd.append('file', arquivo);
      return unwrap($fetch<{ data: { loja: string; gravadas: number; substituidas: number; semBarras: number; entrega: number } }>(
        '/admin/creare/depara', { ...base, method: 'POST', body: fd },
      ));
    },

    // ---- custo, da base de discriminação ----
    /** Prévia da carga de custo. NÃO grava. */
    custoMerPrevia: () =>
      unwrap($fetch<{ data: PreviaCustoMer }>('/admin/produtos/custo-discriminacao/previa', { ...base })),

    /** Grava o custo da compra mais recente em cada produto, em lote. */
    custoMerAplicar: (confirmacao: string) =>
      unwrap($fetch<{ data: { aplicados: number; conflitos: number; restantes: number } }>(
        '/admin/produtos/custo-discriminacao',
        { ...base, method: 'POST', body: { confirmacao } },
      )),

    // ---- estado fiscal ----
    /** Quantos produtos em cada estado fiscal. É o health do fiscal. */
    fiscalPanorama: () =>
      unwrap($fetch<{ data: Record<string, number> }>('/admin/fiscal/panorama', { ...base })),

    /**
     * Completa a carga fiscal em lote. `aplicar` é FALSO por padrão e vai
     * explícito: reescrever fiscal de mil produtos não pode ser o caminho fácil.
     */
    fiscalBackfill: (corpo: {
      aplicar?: boolean; limite?: number; cursor?: string; loja?: string; productId?: string;
    }) =>
      unwrap($fetch<{ data: {
        aplicou: boolean; analisados: number;
        porEstado: Record<string, number>;
        alterados: Array<{ id: string; nome: string; de: string; para: string; motivo: string }>;
        proximoCursor: string | null;
      } }>('/admin/fiscal/backfill', { ...base, method: 'POST', body: corpo })),

    // ---- manutenção do catálogo ----
    /**
     * URL do CSV com a base inteira. É link direto (não fetch) para o navegador
     * salvar o arquivo com o nome que o servidor manda — mesmo caminho do CSV
     * de vendas. Serve de backup antes de zerar.
     */
    produtosCsvUrl: () => `${base.baseURL}/admin/produtos/export.csv`,
    produtosBackupXlsxUrl: () => `${base.baseURL}/admin/produtos/backup.xlsx`,

    /** Quantos seriam apagados e qual frase confirma. Não apaga nada. */
    zerarPrevia: () =>
      unwrap($fetch<{ data: { total: number; apagaveis: number; confirmacao: string; piloto: { codigoInterno: string; nome: string } } }>(
        '/admin/produtos/zerar/previa', { ...base },
      )),

    /**
     * `totalEsperado` é o número que a TELA mostrava. O servidor recusa se ele
     * não bater com o de agora — se alguém cadastrou no meio, a operação para
     * em vez de apagar mais do que foi decidido.
     */
    zerarCatalogo: (confirmacao: string, totalEsperado: number) =>
      unwrap($fetch<{ data: { apagados: number; preservado: { codigoInterno: string; nome: string } } }>('/admin/produtos/zerar', {
        ...base, method: 'POST', body: { confirmacao, totalEsperado },
      })),

    /** Quantos produtos esperam reenvio para a planilha. */
    reenvioPendentes: () =>
      unwrap($fetch<{ data: { aguardando: number; desistidos: number } }>(
        '/admin/produtos/reenvio', { ...base },
      )),

    /**
     * Reenvia agora, sem esperar o job de 5 em 5 minutos.
     *
     * `incluirDesistidos` devolve à fila quem já estourou o teto de tentativas.
     * É uma afirmação humana — "a causa foi corrigida" —, por isso nunca vai
     * ligado por padrão e o job automático não o usa.
     */
    reenviarAgora: (limite = 50, incluirDesistidos = false) =>
      unwrap($fetch<{
        data: {
          tentados: number; sincronizados: number; falharam: number;
          desistidos: number; reanimados: number;
        };
      }>('/admin/produtos/reenvio', {
        ...base, method: 'POST', body: { limite, incluirDesistidos },
      })),

    // ---- admin ----
    dashboard: () => unwrap($fetch<{ data: Dashboard }>('/admin/dashboard', { ...base })),
    listUsers: () => unwrap($fetch<{ data: AdminUser[] }>('/admin/users', { ...base })),
    setUserRole: (id: string, role: 'admin' | 'user') =>
      $fetch(`/admin/users/${id}/role`, { ...base, method: 'PATCH', body: { role } }),

    deleteUser: (id: string) => $fetch(`/admin/users/${id}`, { ...base, method: 'DELETE' }),
  };
}
