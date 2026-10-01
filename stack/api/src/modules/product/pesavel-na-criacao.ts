/** Default somente de produto novo; não usar em edição, seed ou backfill. */
export function pesavelNaCriacao(valor: 'S' | 'N' | null | undefined): 'S' | 'N' {
  return valor ?? 'N';
}
