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
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}
