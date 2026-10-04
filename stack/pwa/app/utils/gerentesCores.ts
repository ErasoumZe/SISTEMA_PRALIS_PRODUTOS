export const COR_VENDA_TOTAL = '#F9AB00';
export const COR_META = '#7C3AED';

const CORES_PDV = ['#1A73E8', '#34A853', '#EA4335', '#FF6D00'] as const;
const CORES_OUTROS = ['#00ACC1', '#D81B60', '#5E35B1', '#6D4C41'] as const;

export function corPdv(nome: string): string {
  const numero = Number(/PDV[-_\s]*(\d+)/i.exec(nome)?.[1]);
  if (numero >= 1 && numero <= CORES_PDV.length) return CORES_PDV[numero - 1]!;

  // Nome sem número de PDV: mantém a mesma cor ao filtrar ou mudar o período.
  let hash = 0;
  for (const caractere of nome.toUpperCase()) hash = (hash * 31 + caractere.charCodeAt(0)) >>> 0;
  return CORES_OUTROS[hash % CORES_OUTROS.length]!;
}
