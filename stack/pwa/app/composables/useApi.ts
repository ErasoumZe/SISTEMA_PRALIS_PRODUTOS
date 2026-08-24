import type { ProductSchemas, ProductRequests, AdminSchemas } from '@pralis/shared';

type Product = ProductSchemas.ProductEntity;
type Dashboard = AdminSchemas.Dashboard;
type AdminUser = AdminSchemas.AdminUser;
export interface GroupTaxRule {
  grupo: string;
  cstPisCofins: string;
  tributacaoSimples: string;
  aliquotaSimples: number;
  icmsRe: number;
  baseFiscal: string;
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
    listProducts: (q?: string, loja?: string) =>
      unwrap($fetch<{ data: Product[] }>('/products', {
        ...base,
        query: { ...(q ? { q } : {}), ...(loja ? { loja } : {}) },
      })),

    listBase: (q?: string) =>
      unwrap($fetch<{ data: Product[] }>('/products/base', { ...base, query: q ? { q } : undefined })),

    importBase: (baseIds: string[]) =>
      unwrap($fetch<{ data: { imported: number; skipped: number } }>('/products/import', { ...base, method: 'POST', body: { baseIds } })),

    getProduct: (id: string) =>
      unwrap($fetch<{ data: Product }>(`/products/${id}`, { ...base })),

    // devolve o envelope inteiro: `details.sheetSync` diz se o espelho na
    // planilha ficou 'synced', 'failed', 'disabled' ou 'skipped'
    createProduct: (body: ProductRequests.CreateProductRequest) =>
      $fetch<{ data: Product; message: string; details: { sheetSync?: SheetSyncStatus } | null }>(
        '/products',
        { ...base, method: 'POST', body },
      ),

    updateProduct: (id: string, body: ProductRequests.UpdateProductRequest) =>
      unwrap($fetch<{ data: Product }>(`/products/${id}`, { ...base, method: 'PUT', body })),

    deleteProduct: (id: string) =>
      $fetch(`/products/${id}`, { ...base, method: 'DELETE' }),

    uploadFoto: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return $fetch<{ data: { url: string } }>('/files', { ...base, method: 'POST', body: fd }).then((r) => r.data.url);
    },

    listGroupTaxRules: () =>
      unwrap($fetch<{ data: GroupTaxRule[] }>('/apoio/grupos-fiscais', { ...base })),

    classifyFiscal: (grupo: string, codigoBarras?: string) =>
      unwrap($fetch<{ data: FiscalClassification }>('/apoio/classificacao-fiscal', {
        ...base, query: { grupo, ...(codigoBarras ? { codigoBarras } : {}) },
      })),

    // ---- admin ----
    dashboard: () => unwrap($fetch<{ data: Dashboard }>('/admin/dashboard', { ...base })),
    listUsers: () => unwrap($fetch<{ data: AdminUser[] }>('/admin/users', { ...base })),
    setUserRole: (id: string, role: 'admin' | 'user') =>
      $fetch(`/admin/users/${id}/role`, { ...base, method: 'PATCH', body: { role } }),

    deleteUser: (id: string) => $fetch(`/admin/users/${id}`, { ...base, method: 'DELETE' }),
  };
}
