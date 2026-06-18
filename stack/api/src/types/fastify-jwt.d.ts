import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; sessionId: string };
    user: { sub: string; sessionId: string };
  }
}
