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
 * Os 12 casos medidos em 11/09 estão resolvidos abaixo por código de barras,
 * sem transformar um grupo amplo em uma equivalência global.
 */
export const GRUPOS_LEGADOS: Readonly<Record<string, EquivalenciaDeGrupo>> = {};

/**
 * Exceções por PRODUTO, comprovadas pelo código de barras no export do SIA.
 *
 * O mapa por grupo continua vazio: `SORVETES`, `BOMBONIERI` e os demais são
 * amplos demais para receber uma regra única. Aqui a decisão é estreita: vale
 * somente para a mercadoria identificada pelo EAN/PLU abaixo. Assim um chiclete
 * futuro em `BOMBONIERI`, por exemplo, não herda a regra de chocolate.
 */
/**
 * CONFERÊNCIA DE 14/09/2026 — `scripts/conferir-12-decisoes.ts`
 *
 * O que a conferência achou, cruzando cada código com `BASE FULL SIA TNP`
 * (7.131 linhas) e `BASE FULL SIA LI` (8.332 linhas):
 *
 *  - o export do SIA NÃO TEM coluna de grupo. Ele tem descrição, código do
 *    produto e código de barras. Então "auditoria SIA" confirma QUAL PRODUTO é
 *    o código — e só isso. O passo seguinte, produto -> grupo oficial, é
 *    julgamento humano registrado, não dado copiado. São coisas diferentes e o
 *    campo `por` não pode dar a entender que a fonte escolheu o grupo.
 *
 *  - 8 das 12 se sustentam: o código casa com um produto único e o nome não
 *    deixa dúvida de grupo (AGRIAO, EQLIBRI, LAKA, TRENTO, SORVETE 360ML e as
 *    duas águas DELIVERY; `7894900531005` é água COM gás no SIA, o que não
 *    muda o grupo).
 *
 *  - `11667` e `11844` COLIDEM. O mesmo código interno aparece como água numa
 *    loja e como outro produto na outra:
 *        11667 -> AGUA CRYSTAL S/GAS 500ML   e   ACAI 200ML ... PALETITAS
 *        11844 -> AGUA CRYSTAL S/GAS 300ML   e   MENTOS RAINBOW 37,5G
 *    Aplicar grupo por essa chave classificaria açaí como água. Código interno
 *    é por loja; código de barras não é.
 *
 *  - `7898229388602` (LINGUICA CALABRESA 2,5 KG) e `7894900521504`
 *    (AGUA CRYSTAL FRUTAS VERMELHAS) NÃO EXISTEM em nenhum dos dois exports.
 *    A justificativa "auditoria SIA" não se sustenta para esses dois. E água
 *    saborizada não é obviamente `MER BEBIDAS - ÁGUAS`.
 *
 * Nada foi removido aqui: a decisão é do dono do cadastro. Mas NENHUMA destas
 * vale até o backfill rodar com `--apply`, então há tempo de resolver os
 * quatro antes de qualquer produto mudar de grupo.
 */
export const GRUPOS_LEGADOS_POR_BARRAS: Readonly<Record<string, EquivalenciaDeGrupo & { legado: string }>> = {
  '7892840267841': { legado: 'BISCOITO', oficial: 'MER BISCOITOS - SALGADOS', decidido: '2026-09-11', por: 'auditoria SIA: EQLIBRI PRESUNTO DEFUMADO 40G' },
  '7622210573353': { legado: 'BOMBONIERI', oficial: 'MER BOMBONIERI - CHOCOLATES', decidido: '2026-09-11', por: 'auditoria SIA: LAKA 34G' },
  '7896306612817': { legado: 'BOMBONIERI', oficial: 'MER BOMBONIERI - CHOCOLATES', decidido: '2026-09-11', por: 'auditoria SIA: TRENTO CHOCOLATE 32G' },
  '7898229388602': { legado: 'GERAL', oficial: 'MER MAT. PRIMA - PROTEINAS', decidido: '2026-09-11', por: 'auditoria SIA: LINGUICA CALABRESA 2,5 KG' },
  '7898944767454': { legado: 'SORVETES', oficial: 'MER SORVETES - POTES', decidido: '2026-09-11', por: 'auditoria SIA: SORVETE 360ML' },
  '10772': { legado: 'MAT. PRIMA (FARINHA)', oficial: 'MER MAT. PRIMA - VERDURAS', decidido: '2026-09-11', por: 'auditoria SIA: AGRIAO UND' },
  '7894900531005': { legado: 'SUCO, ISOT E AGUA', oficial: 'MER BEBIDAS - ÁGUAS', decidido: '2026-09-11', por: 'auditoria SIA: AGUA CRYSTAL 500ML' },
  '11844': { legado: 'SUCO, ISOT E AGUA', oficial: 'MER BEBIDAS - ÁGUAS', decidido: '2026-09-11', por: 'auditoria SIA: AGUA CRYSTAL 300ML' },
  '11667': { legado: 'SUCO, ISOT E AGUA', oficial: 'MER BEBIDAS - ÁGUAS', decidido: '2026-09-11', por: 'auditoria SIA: AGUA CRYSTAL 500ML' },
  '711844': { legado: 'SUCO, ISOT E AGUA', oficial: 'MER BEBIDAS - ÁGUAS', decidido: '2026-09-11', por: 'auditoria SIA: AGUA CRYSTAL 300ML DELIVERY' },
  '711667': { legado: 'SUCO, ISOT E AGUA', oficial: 'MER BEBIDAS - ÁGUAS', decidido: '2026-09-11', por: 'auditoria SIA: AGUA CRYSTAL 500ML DELIVERY' },
  '7894900521504': { legado: 'SUCO, ISOT E AGUA', oficial: 'MER BEBIDAS - ÁGUAS', decidido: '2026-09-11', por: 'auditoria SIA: AGUA CRYSTAL FRUTAS VERMELHAS' },
};

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

const chaveBarras = (valor?: string | null): string =>
  String(valor ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/** Prioriza a decisão estreita por produto; só depois consulta o mapa global. */
export const grupoOficialDoProduto = (
  legado?: string | null,
  codigoBarras?: string | null,
): EquivalenciaDeGrupo | null => {
  const porProduto = GRUPOS_LEGADOS_POR_BARRAS[chaveBarras(codigoBarras)];
  if (porProduto && porProduto.legado === String(legado ?? '').trim().toUpperCase()) return porProduto;
  return grupoOficialDe(legado);
};
