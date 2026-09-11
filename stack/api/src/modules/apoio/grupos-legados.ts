/**
 * De-para de grupos LEGADOS para os grupos oficiais da tabela fiscal.
 *
 * O problema: 12 produtos estão gravados com 6 grupos que não existem entre as
 * 76 regras oficiais — `SUCO, ISOT E AGUA` (6 produtos), `BOMBONIERI` (2),
 * `BISCOITO`, `GERAL`, `SORVETES` e `MAT. PRIMA (FARINHA)`. São nomes da
 * planilha antiga, de antes de a tabela por grupo existir. Sem regra, esses
 * produtos ficam em `pendente_grupo_invalido` e não recebem carga fiscal
 * nenhuma.
 *
 * Por que este arquivo começa VAZIO: a equivalência não está no dado. A tabela
 * oficial tem `MER SORVETES - POTES` e `MER SORVETES - PICOLÉS`; o grupo legado
 * diz só `SORVETES`, e os dois têm tributação diferente. Escolher por
 * semelhança de texto seria atribuir imposto por parecença de palavra — que é
 * exatamente o que este projeto não faz. Vale igual para os outros cinco.
 *
 * Quem preenche: o administrador, com a lista que
 * `scripts/grupos-legados.ts` gera (produto a produto, com o grupo atual e os
 * candidatos oficiais). Cada linha aqui é uma DECISÃO registrada, com data e
 * quem decidiu — é por isso que o de-para mora no código versionado e não numa
 * tabela editável: assim ele aparece no diff, no PR e no histórico.
 *
 * Formato:
 *
 *     'GRUPO LEGADO': { oficial: 'MER ... - ...', decidido: 'AAAA-MM-DD', por: 'nome' },
 *
 * Nada aqui é aplicado retroativamente sozinho: quem aplica é o backfill, e ele
 * só roda com `--apply` explícito.
 */
export interface EquivalenciaDeGrupo {
  /** O grupo da tabela oficial, escrito exatamente como ela escreve. */
  oficial: string;
  /** Data da decisão, `AAAA-MM-DD`. */
  decidido: string;
  /** Quem decidiu. Serve para saber a quem perguntar depois. */
  por: string;
}

/**
 * Vazio de propósito. Ver o cabeçalho: preencher sem decisão é inventar
 * classificação fiscal.
 *
 * Pendentes hoje (12 produtos, 6 grupos):
 *   SUCO, ISOT E AGUA · BOMBONIERI · BISCOITO · GERAL · SORVETES ·
 *   MAT. PRIMA (FARINHA)
 */
export const GRUPOS_LEGADOS: Readonly<Record<string, EquivalenciaDeGrupo>> = {};

/**
 * A busca, separada do mapa para poder ser testada com decisões de mentira —
 * o mapa de verdade está vazio, e um teste que dependesse dele quebraria no dia
 * em que alguém decidisse a primeira equivalência.
 *
 * Compara em maiúsculas e sem espaço sobrando, que é a única normalização
 * segura aqui: não tira acento nem pontuação, porque `MAT. PRIMA (FARINHA)`
 * depende do ponto e dos parênteses para não colidir com outro grupo.
 */
export const grupoOficialEm = (
  mapa: Readonly<Record<string, EquivalenciaDeGrupo>>,
  legado?: string | null,
): EquivalenciaDeGrupo | null => mapa[String(legado ?? '').trim().toUpperCase()] ?? null;

/** O grupo oficial equivalente, ou `null` quando ainda não foi decidido. */
export const grupoOficialDe = (legado?: string | null): EquivalenciaDeGrupo | null =>
  grupoOficialEm(GRUPOS_LEGADOS, legado);
