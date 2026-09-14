import type { VendasRanking } from '@pralis/shared';

/**
 * Quem pode ver FATURAMENTO num ranking, e o que sobra para quem não pode.
 *
 * O painel de setores nasceu para ficar ligado num monitor, à vista de quem
 * trabalha no salão. Tirar a coluna do HTML não esconderia nada: o número
 * continuaria viajando na resposta da API, e qualquer pessoa o lê abrindo as
 * ferramentas do navegador. Sigilo que só existe na tela não é sigilo.
 *
 * Por isso a decisão é do SERVIDOR: quem não pode ver, não recebe.
 */

/**
 * Só o administrador vê dinheiro.
 *
 * Sem usuário NÃO é "todo mundo" — é ninguém. Num controle de sigilo, o único
 * erro aceitável é errar para o lado de esconder.
 */
export const podeVerDinheiro = (user: { role?: string } | undefined): boolean =>
  user?.role === 'admin';

/**
 * A mesma resposta, sem nenhum valor em reais.
 *
 * O que SOBREVIVE é o que a tela precisa para funcionar: ordem, rótulo, pontos
 * e participação. Participação é proporção — dizer que a panificação fez 60%
 * do período não revela quanto foi o período.
 *
 * ATENÇÃO, e isto está documentado de propósito: `pontos` é
 * `faturamento * 0,25`. Quem conhece a regra dos 25% divide os pontos por 0,25
 * e chega ao faturamento exato. Esta função tira o número da resposta; ela NÃO
 * torna o faturamento indedutível. Sigilo de verdade pediria uma escala que
 * não seja função linear do dinheiro com fator conhecido — decisão do dono do
 * negócio, não do código.
 */
export const semDinheiro = (r: VendasRanking.VendasRanking): VendasRanking.VendasRanking => ({
  ...r,
  faturamentoTotal: null,
  itens: r.itens.map((i) => ({ ...i, faturamento: null })),
  cobertura: {
    ...r.cobertura,
    faturamentoClassificado: null,
    faturamentoSemClassificacao: null,
  },
});
