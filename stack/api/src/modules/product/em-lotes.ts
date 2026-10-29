/**
 * Aplica `fn` a todos os itens, no máximo `tamanho` de cada vez, mantendo a ordem.
 *
 * Existe por causa do backup XLSX (29/10/2026): ele buscava cada produto com
 * `Promise.all` sobre TODOS os IDs de uma vez. Com o catálogo atual (milhares
 * de produtos somando BASE, TNP e LI) isso abria milhares de consultas
 * simultâneas, esgotava o pool do banco e a rota respondia "Erro interno".
 */
export async function emLotes<T, R>(itens: readonly T[], tamanho: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(tamanho) || tamanho < 1) throw new Error('tamanho do lote precisa ser inteiro >= 1');
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  }
  return saida;
}
