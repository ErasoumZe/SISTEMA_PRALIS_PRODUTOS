import '@fastify/jwt';
import 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; sessionId: string };
    user: { sub: string; sessionId: string };
  }
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  loja: 'TNP' | 'LI' | 'HORA' | null; // null para admin (sem loja; casa = BASE)
  role: 'admin' | 'user';
  /**
   * As telas que esta pessoa enxerga, resolvidas pelo `authMiddleware`.
   *
   * Opcional no tipo porque testes montam `CurrentUser` a mao; ausente conta
   * como "nenhuma tela" na guarda, que e o lado seguro do engano.
   */
  telas?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}
