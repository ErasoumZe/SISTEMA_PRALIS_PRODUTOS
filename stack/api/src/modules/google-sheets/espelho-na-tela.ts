import { comPrazo } from './prazo';
import type { SheetSyncOutcome } from './product-sheet.service';

/**
 * Quanto uma requisição INTERATIVA espera pela planilha antes de devolver o
 * controle a quem está na tela.
 *
 * Bem menor que o prazo do cliente do Google (20 s), e de propósito: aquele é
 * o teto de uma chamada de fundo; este é o tempo que alguém aguenta parado na
 * frente do balcão. Numa planilha saudável o espelho volta em 300–500 ms e
 * ninguém nota o prazo existir.
 *
 * Mora aqui, e não no serviço de produto, porque são DOIS caminhos que
 * gravam produto e esperam a planilha: o cadastro e a unificação. O segundo
 * ficou de fora quando isto nasceu no primeiro, e foi justamente ele que
 * travou a tela em "0 de 114".
 */
export const PRAZO_ESPELHO_NA_TELA = 8000;

/** O que uma tentativa de espelho devolve, no mínimo que interessa aqui. */
export interface TentativaDeEspelho {
  outcome: SheetSyncOutcome;
  rowNumber: number | null;
}

/**
 * Espera o espelho, mas não para sempre.
 *
 * A chamada abandonada CONTINUA correndo e marca a própria linha na outbox —
 * não se perde, só deixa de segurar a requisição. Quem termina o serviço é a
 * fila de reenvio, que roda a cada cinco minutos e sabe repetir com recuo.
 *
 * Estourando o prazo, o resultado é `pending`: diferente de `failed`, que já
 * foi tentado e recusado. A distinção é o que permite a tela dizer a verdade
 * em vez de acender alarme para algo que vai se resolver sozinho.
 */
export const esperarEspelho = async (
  tentativa: Promise<TentativaDeEspelho>,
): Promise<TentativaDeEspelho> =>
  comPrazo(tentativa, PRAZO_ESPELHO_NA_TELA, 'espelho na planilha')
    .catch(() => ({ outcome: 'pending' as const, rowNumber: null }));
