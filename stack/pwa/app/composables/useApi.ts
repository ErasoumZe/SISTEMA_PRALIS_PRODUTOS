import type { ProductSchemas, ProductRequests } from '@pralis/shared';

type Product = ProductSchemas.ProductEntity;

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

    createProduct: (body: ProductRequests.CreateProductRequest) =>
      unwrap($fetch<{ data: Product }>('/products', { ...base, method: 'POST', body })),

    updateProduct: (id: string, body: ProductRequests.UpdateProductRequest) =>
      unwrap($fetch<{ data: Product }>(`/products/${id}`, { ...base, method: 'PUT', body })),

    deleteProduct: (id: string) =>
      $fetch(`/products/${id}`, { ...base, method: 'DELETE' }),

    uploadFoto: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return $fetch<{ data: { url: string } }>('/files', { ...base, method: 'POST', body: fd }).then((r) => r.data.url);
    },
  };
}
