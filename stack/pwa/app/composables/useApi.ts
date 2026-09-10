import type { ProductSchemas, ProductRequests, AdminSchemas, VendasSchemas, VendasDePara, VendasUnicos } from '@pralis/shared';

type Product = ProductSchemas.ProductEntity;
type Dashboard = AdminSchemas.Dashboard;
type AdminUser = AdminSchemas.AdminUser;
export type VendasReport = VendasSchemas.VendasReport;
export type VendasReportQuery = VendasSchemas.VendasReportQuery;
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
  pagina?: number; tamanho?: number;
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
export type SheetSyncStatus = 'synced' | 'failed' | 'disabled' | 'skipped' | 'misconfigured';

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
    unificacaoHealth: () =>
      unwrap($fetch<{ data: { totais: TotaisUnificacao } }>('/admin/unificacao/health', { ...base })),
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

    // ---- admin ----
    dashboard: () => unwrap($fetch<{ data: Dashboard }>('/admin/dashboard', { ...base })),
    listUsers: () => unwrap($fetch<{ data: AdminUser[] }>('/admin/users', { ...base })),
    setUserRole: (id: string, role: 'admin' | 'user') =>
      $fetch(`/admin/users/${id}/role`, { ...base, method: 'PATCH', body: { role } }),

    deleteUser: (id: string) => $fetch(`/admin/users/${id}`, { ...base, method: 'DELETE' }),
  };
}
