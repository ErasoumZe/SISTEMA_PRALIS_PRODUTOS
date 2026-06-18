import 'dotenv/config';

/**
 * Configuração de ambiente. Mantida simples nesta fase.
 * Depois entram: JWT_SECRET, RESEND_API_KEY, CLOUDINARY_*, REDIS_URL, etc.
 */
export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'dev',
  PORT: Number(process.env.PORT ?? 3333),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-jwt-secret-troque-em-producao',
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? 'dev-cookie-secret-troque-em-producao',
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL ?? 'rodrigo@cicluz.com.br').toLowerCase(),
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ?? '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ?? '',
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  EMAIL_FROM: process.env.EMAIL_FROM ?? 'Pralis <onboarding@resend.dev>',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/pralis',
  PG_POOL_MAX: Number(process.env.PG_POOL_MAX ?? 10),
  PG_IDLE_TIMEOUT_MS: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000),
  PG_CONN_TIMEOUT_MS: Number(process.env.PG_CONN_TIMEOUT_MS ?? 5000),
};
