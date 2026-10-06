/**
 * Produto sem EAN nasce com o próprio código interno no campo de barras.
 *
 * Decisão do José em 06/10/2026. É a convenção que o SIA já usa: medido em
 * 25/09/2026, 72% do cadastro do PDV guarda o coditem no campo `codbarras` de
 * quem não tem código de indústria. Sem isso, o produto da casa (pão, bolo,
 * salgado) ficava sem nada para ler no caixa, e a etiqueta da balança era a
 * única forma de vendê-lo.
 *
 * Combina com a regra de pesável de 06/10/2026 (PR #141), que trata "barras
 * iguais ao código interno" como ausência de EAN e mantém o produto pesável —
 * preencher este campo não tira ninguém da balança.
 *
 * Somente na CRIAÇÃO, e somente quando o campo veio vazio: na edição, campo
 * de barras em branco é escolha de quem está editando, e sobrescrever seria
 * decidir no lugar da pessoa. O valor digitado é devolvido como veio, sem
 * normalizar — quem valida formato de EAN é outro caminho.
 */
export function codigoBarrasNaCriacao(
  codigoBarras: string | null | undefined,
  codigoInterno: string | null | undefined,
): string | null {
  if (String(codigoBarras ?? '').trim()) return codigoBarras as string;
  const interno = String(codigoInterno ?? '').trim();
  return interno || null;
}
