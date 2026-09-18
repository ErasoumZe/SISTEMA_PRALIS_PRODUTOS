/**
 * Último código que já existia no Criare antes da integração automática.
 *
 * Os produtos antigos do Pralis continuam com seus códigos atuais. Para novos
 * cadastros, porém, a sequência precisa começar depois da faixa que o Criare já
 * usa, evitando que o TXT altere outro produto por colisão de código.
 */
export const ULTIMO_CODIGO_LEGADO_CREARE = 1325;

/** Próximo código, considerando o maior já salvo e o piso legado do Criare. */
export const calcularProximoCodigoInterno = (maiorCodigoAtual: number): string =>
  String(Math.max(maiorCodigoAtual, ULTIMO_CODIGO_LEGADO_CREARE) + 1).padStart(5, '0');
