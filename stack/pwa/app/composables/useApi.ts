import type { ProductSchemas, ProductRequests, AdminSchemas, VendasSchemas, VendasDePara, VendasUnicos, VendasRanking, VendasAbc, VendasPulso } from '@pralis/shared';

type Product = ProductSchemas.ProductEntity;
type Dashboard = AdminSchemas.Dashboard;
type AdminUser = AdminSchemas.AdminUser;
export type VendasReport = VendasSchemas.VendasReport;
export type VendasReportQuery = VendasSchemas.VendasReportQuery;
export type VendasRankingResposta = VendasRanking.VendasRanking;
export type VendasRankingQuery = VendasRanking.VendasRankingQuery;
export type ItemRanking = VendasRanking.ItemRanking;
export type AbcProdutos = VendasAbc.AbcProdutos;
export type AbcProdutosQuery = VendasAbc.AbcProdutosQuery;
export type Pulso = VendasPulso.Pulso;
export type DeParaLista = VendasDePara.DeParaLista;
export type DeParaQuery = VendasDePara.DeParaQuery;
export type VincularBody = VendasDePara.VincularBody;
export type ProdutosUnicos = VendasUnicos.ProdutosUnicos;
export type ProdutosUnicosQuery = VendasUnicos.ProdutosUnicosQuery;

/** Uma linha de fonte dentro do grupo, como veio do staging. */
export interface ItemUnificacao {
  fonte: string; loja: string; codInterno: string | null; codBarras: string | null;
  nome: string | null; ativo: boolean | null; grupo: string | null;
  custo: string | null; venda: string | null; ncm: string | null; cst: string | null;
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
      unwrap($fetch<{ data: { totais: TotaisUnificacao } }>(
        '/admin/unificacao/health', { ...base, query },
      )),
    /** Os filtros vão para o SERVIDOR: a tela nunca peneira 4.300 no navegador. */
    unificacaoGrupos: (query: FiltrosUnificacao) =>
      unwrap($fetch<{ data: PaginaGrupos }>('/admin/unificacao/grupos', { ...base, query })),
    unificacaoUnificar: (id: string, forcar = false) =>
      $fetch(`/admin/unificacao/grupos/${id}/unificar`, { ...base, method: 'POST', body: { forcar } }),
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

    /** Quantos seriam apagados e qual frase confirma. Não apaga nada. */
    zerarPrevia: () =>
      unwrap($fetch<{ data: { total: number; confirmacao: string } }>(
        '/admin/produtos/zerar/previa', { ...base },
      )),

    /**
     * `totalEsperado` é o número que a TELA mostrava. O servidor recusa se ele
     * não bater com o de agora — se alguém cadastrou no meio, a operação para
     * em vez de apagar mais do que foi decidido.
     */
    zerarCatalogo: (confirmacao: string, totalEsperado: number) =>
      unwrap($fetch<{ data: { apagados: number } }>('/admin/produtos/zerar', {
        ...base, method: 'POST', body: { confirmacao, totalEsperado },
      })),

    /** Quantos produtos esperam reenvio para a planilha. */
    reenvioPendentes: () =>
      unwrap($fetch<{ data: { aguardando: number; desistidos: number } }>(
        '/admin/produtos/reenvio', { ...base },
      )),

    /** Reenvia agora, sem esperar o job de 5 em 5 minutos. */
    reenviarAgora: (limite = 50) =>
      unwrap($fetch<{ data: { tentados: number; sincronizados: number; falharam: number; desistidos: number } }>(
        '/admin/produtos/reenvio', { ...base, method: 'POST', body: { limite } },
      )),

    // ---- admin ----
    dashboard: () => unwrap($fetch<{ data: Dashboard }>('/admin/dashboard', { ...base })),
    listUsers: () => unwrap($fetch<{ data: AdminUser[] }>('/admin/users', { ...base })),
    setUserRole: (id: string, role: 'admin' | 'user') =>
      $fetch(`/admin/users/${id}/role`, { ...base, method: 'PATCH', body: { role } }),

    deleteUser: (id: string) => $fetch(`/admin/users/${id}`, { ...base, method: 'DELETE' }),
  };
}
