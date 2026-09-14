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
