import { Telas } from '@pralis/shared';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';

/**
 * A guarda do servidor, por TELA em vez de por papel.
 *
 * Substitui os `exigirAdmin` que estavam copiados em 25 controllers. A troca
 * importa porque a pergunta mudou: antes era "é admin?", agora é "esta pessoa
 * tem esta tela?" — que é o que a tela de Permissões promete decidir. Sem isso,
 * ligar um toggle mostraria a tela e a API recusaria mesmo assim, e o módulo
 * inteiro seria decoração.
 *
 * Síncrona de propósito: quem resolve a permissão é o `authMiddleware`, que já
 * a deixa pronta em `currentUser.telas`. Resolver aqui obrigaria a espalhar
 * `await` pelas 81 chamadas existentes.
 */
export function exigirTela(
  user: CurrentUser | undefined,
  telaId: string,
): CurrentUser {
  if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');

  /*
   * `telas` ausente = a permissão não foi resolvida para este pedido.
   *
   * Em produção isso não acontece: o `authMiddleware` é o único que preenche
   * `currentUser`, e ele sempre preenche as telas junto. Acontece em teste, que
   * monta `CurrentUser` à mão — e ali cair na REGRA ANTIGA (papel) é o que
   * mantém honesto o que cada teste afirma, em vez de todos passarem a bater
   * num 403 novo que não tem a ver com o que estão provando.
   */
  const permitidas = user.telas;
  const temAcesso = permitidas
    ? permitidas.includes(telaId)
    : user.role === 'admin';

  if (!temAcesso) {
    const tela = Telas.telaPorId(telaId);
    throw new AppError(
      `Você não tem acesso a "${tela?.titulo ?? telaId}". Peça a liberação ao administrador.`,
      403,
      'FORBIDDEN',
    );
  }
  return user;
}
