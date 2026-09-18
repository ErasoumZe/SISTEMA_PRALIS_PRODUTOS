/**
 * Último código que já existia no Criare antes da integração automática.
 *
 * Os produtos antigos do Pralis continuam com seus códigos atuais. Para novos
 * cadastros, porém, a sequência precisa começar depois da faixa que o Criare já
 * usa, evitando que o TXT altere outro produto por colisão de código.
 */
export const ULTIMO_CODIGO_LEGADO_POR_LOJA = {
  BASE: 1325,
  TNP: 1325,
  LI: 4396,
  HORA: 0,
} as const;

export type LojaCodigoInterno = keyof typeof ULTIMO_CODIGO_LEGADO_POR_LOJA;

/** Próximo código, considerando o maior já salvo e o piso legado do Criare. */
export const calcularProximoCodigoInterno = (
  maiorCodigoAtual: number,
  loja: LojaCodigoInterno = 'BASE',
): string => String(
  Math.max(maiorCodigoAtual, ULTIMO_CODIGO_LEGADO_POR_LOJA[loja]) + 1,
).padStart(5, '0');
