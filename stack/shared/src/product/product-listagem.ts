/**
 * Como as listas de produto abrem: mostrando só o que está ATIVO.
 *
 * Decisão do José em 06/10/2026. O catálogo da TNP tem 7.177 produtos e só
 * 2.351 ativos — dois terços da lista são histórico que ninguém opera no dia a
 * dia. Abrir no catálogo inteiro faz a pessoa rolar por produto morto para
 * achar o que vende.
 *
 * Isto é um PADRÃO, não uma trava: quem quiser ver inativo desliga o filtro na
 * própria tela, e o atalho `?status=inativo` continua abrindo a lista nos
 * inativos. Por isso a regra mora aqui, pura e testada, e não espalhada em
 * cada `ref(null)` de página: antes dela, a mesma pergunta ("o que a lista
 * mostra quando ninguém escolheu?") tinha uma resposta diferente em cada tela.
 */

/** O que a pessoa escolheu ver. `null` é "tudo", inclusive inativo. */
export type FiltroStatus = 'ativo' | 'inativo' | null;

/** Como toda lista de produto abre, na base geral e nas lojas. */
export const STATUS_INICIAL_DA_LISTA: FiltroStatus = 'ativo';

/**
 * Lê o filtro vindo da URL (`/?status=...`), que é como os atalhos do painel
 * abrem a lista já filtrada. `todos` existe para um atalho poder pedir, de
 * propósito, o catálogo inteiro; qualquer outro valor cai no padrão.
 */
export function lerFiltroStatus(valor: unknown): FiltroStatus {
  const texto = String(valor ?? '').trim().toLowerCase();
  if (texto === 'ativo' || texto === 'inativo') return texto;
  if (texto === 'todos') return null;
  return STATUS_INICIAL_DA_LISTA;
}

/** Um produto aparece na lista? */
export function passaNoFiltroStatus(status: string | null | undefined, filtro: FiltroStatus): boolean {
  if (!filtro) return true;
  return status === filtro;
}

export function filtrarPorStatus<T extends { status?: string | null }>(itens: T[], filtro: FiltroStatus): T[] {
  if (!filtro) return [...itens];
  return itens.filter((item) => passaNoFiltroStatus(item.status, filtro));
}

/**
 * O filtro de status conta como "refinamento" para o contador de filtros da
 * tela? Só quando a pessoa saiu do padrão — senão o contador abriria marcando
 * 1 em toda visita, e "Limpar filtros" ficaria aceso sem ninguém ter filtrado.
 */
export function statusFoiAlterado(filtro: FiltroStatus): boolean {
  return filtro !== STATUS_INICIAL_DA_LISTA;
}
