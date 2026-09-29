import type { ProductRequests } from '@pralis/shared';

type Entrada = ProductRequests.CreateProductRequest | ProductRequests.UpdateProductRequest;

/** Apenas textos descritivos digitados no cadastro; códigos, URLs e enums ficam intactos. */
const CAMPOS_DESCRITIVOS = [
  'nome', 'marca', 'setorEstoque', 'setorVenda1', 'setorVenda2', 'localVenda1', 'localVenda2',
] as const;

const maiusculas = (valor: string | null | undefined): string | null | undefined =>
  typeof valor === 'string' ? valor.toLocaleUpperCase('pt-BR') : valor;

export function normalizarTextosProduto<T extends Entrada>(entrada: T): T {
  const resultado = { ...entrada } as T;
  for (const campo of CAMPOS_DESCRITIVOS) {
    if (typeof resultado[campo] === 'string') {
      (resultado as Record<string, unknown>)[campo] = maiusculas(resultado[campo]);
    }
  }
  if (resultado.transformacao?.produtoReceituario) {
    resultado.transformacao = {
      ...resultado.transformacao,
      produtoReceituario: maiusculas(resultado.transformacao.produtoReceituario) ?? null,
    };
  }
  if (resultado.fiscal?.categoria) {
    resultado.fiscal = {
      ...resultado.fiscal,
      categoria: maiusculas(resultado.fiscal.categoria) ?? null,
    };
  }
  return resultado;
}
