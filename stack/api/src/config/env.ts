import 'dotenv/config';

/** Lê uma env var tratando string vazia como ausente (compose injeta '' para ${VAR} não setada). */
const envVar = (key: string, fallback: string): string => {
  const v = process.env[key];
  return v != null && v.trim() !== '' ? v : fallback;
};

const envBool = (key: string, fallback = false): boolean => {
  const v = process.env[key];
  if (v == null || v.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(v.trim().toLowerCase());
};

/**
 * A chave privada da conta de serviço costuma chegar em UMA linha, com "\n" literal
 * (painéis como o Coolify não preservam quebras). Normaliza para quebras reais e
 * remove aspas envolventes se o valor foi colado com elas.
 */
export const normalizePrivateKey = (raw: string): string =>
  raw.trim().replace(/^["']|["']$/g, '').replace(/\r/g, '').replace(/\n/g, '\n');

/**
 * Configuração de ambiente. Mantida simples nesta fase.
 * NUNCA logar os valores de segredos (JWT, cookie, Cloudinary, Google).
 */
export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'dev',
  PORT: Number(process.env.PORT ?? 3333),
  CORS_ORIGIN: envVar('CORS_ORIGIN', '*'),
  JWT_SECRET: envVar('JWT_SECRET', 'dev-jwt-secret-troque-em-producao'),
  COOKIE_SECRET: envVar('COOKIE_SECRET', 'dev-cookie-secret-troque-em-producao'),
  ADMIN_EMAIL: envVar('ADMIN_EMAIL', 'rodrigo@cicluz.com.br').toLowerCase(),
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ?? '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ?? '',
  RESEND_API_KEY: envVar('RESEND_API_KEY', ''),
  EMAIL_FROM: envVar('EMAIL_FROM', 'Pralis <onboarding@resend.dev>'),
  DATABASE_URL: envVar('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/pralis'),
  PG_POOL_MAX: Number(process.env.PG_POOL_MAX ?? 10),
  PG_IDLE_TIMEOUT_MS: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000),
  PG_CONN_TIMEOUT_MS: Number(process.env.PG_CONN_TIMEOUT_MS ?? 5000),

  // ---- Google Sheets (espelho do cadastro da BASE; Postgres continua a fonte principal) ----
  GOOGLE_SHEETS_ENABLED: envBool('GOOGLE_SHEETS_ENABLED', false),
  GOOGLE_SHEETS_SPREADSHEET_ID: envVar('GOOGLE_SHEETS_SPREADSHEET_ID', '1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w'),
  GOOGLE_SHEETS_BASE_TAB: envVar('GOOGLE_SHEETS_BASE_TAB', '(BASE) CADASTRO PRODUTOS'),
  GOOGLE_SHEETS_DEFAULT_LOJAS: envVar('GOOGLE_SHEETS_DEFAULT_LOJAS', 'TNP,LI,HORA'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: envVar('GOOGLE_SERVICE_ACCOUNT_EMAIL', ''),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: normalizePrivateKey(envVar('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', '')),
};
