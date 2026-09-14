/**
 * Prazo máximo para uma chamada ao Google.
 *
 * Por que isto existe, com data: em 14/09/2026, ler QUATRO células (`A1:B2`)
 * da aba `(TNP/LI) CADASTRO PRODUTOS` não voltou em 30 segundos. Os metadados
 * da mesma planilha voltam em 440 ms — ou seja, não é rede nem cota: é a
 * planilha, com 8,88 milhões de células (88,8% do limite do Google), que não
 * consegue ser recalculada a tempo de servir qualquer valor.
 *
 * O cliente do Google não tinha prazo nenhum. Uma chamada travada pendurava a
 * requisição HTTP inteira — e o produto JÁ estava salvo no banco desde o
 * primeiro instante. A pessoa via a tela girar e cadastrava de novo.
 *
 * Com prazo, a falha é rápida e o caminho que já existia assume: a linha fica
 * `failed` na outbox e a fila de reenvio tenta de novo sozinha. Trocar uma
 * espera infinita por uma pendência visível é o objetivo — não é esconder a
 * lentidão, é parar de repassá-la para quem está no balcão.
 */

/** Estourou o prazo. Tipo próprio para a fila distinguir de erro do Google. */
export class PrazoEsgotadoError extends Error {
  constructor(public readonly operacao: string, public readonly prazoMs: number) {
    super(
      `A planilha não respondeu em ${prazoMs} ms (${operacao}). `
      + 'O produto está salvo; a sincronização entra na fila de reenvio.',
    );
    this.name = 'PrazoEsgotadoError';
  }
}

/**
 * Corre a promessa contra o relógio.
 *
 * `prazoMs <= 0` desliga o relógio — válvula para rotinas longas de operação,
 * como um backfill grande, em que esperar é o esperado.
 *
 * O timer é SEMPRE cancelado: sem isso, cada chamada bem-sucedida deixaria um
 * temporizador vivo segurando o processo de pé por até o prazo inteiro.
 */
export const comPrazo = async <T>(
  promessa: Promise<T>,
  prazoMs: number,
  operacao: string,
): Promise<T> => {
  if (!Number.isFinite(prazoMs) || prazoMs <= 0) return promessa;

  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        relogio = setTimeout(() => rejeitar(new PrazoEsgotadoError(operacao, prazoMs)), prazoMs);
      }),
    ]);
  } finally {
    if (relogio) clearTimeout(relogio);
  }
};
