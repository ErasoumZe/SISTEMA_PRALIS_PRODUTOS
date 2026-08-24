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
 * A chave privada da conta de serviço costuma chegar em UMA linha, com a
 * sequência LITERAL de dois caracteres `\` + `n` no lugar da quebra (painéis
 * como o Coolify não preservam quebras reais). Converte essas sequências em
 * quebras de verdade SEM corromper uma chave que já venha quebrada.
 *
 * Usa split/join com strings literais de propósito: escapar barra invertida
 * dentro de regex é justamente onde a versão anterior errou — ela usava `/\n/`,
 * que casa a quebra REAL e por isso não trocava nada.
 *
 * Trata, nesta ordem: aspas envolventes (só quando o par casa), `\r\n` / `\n` /
 * `\r` literais, CRLF e CR reais; e garante exatamente uma quebra final (PEM).
 * Valor ausente continua vazio, para o cliente saber que não há credencial.
 */
export const normalizePrivateKey = (raw: string): string => {
  const semAspas = raw.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  if (semAspas === '') return '';
  const comQuebras = semAspas
    .split('\\r\\n').join('\n') // "\r\n" literais
    .split('\\n').join('\n') // "\n" literais
    .split('\\r').join('\n') // "\r" literais
    .split('\r\n').join('\n') // CRLF real
    .split('\r').join('\n') // CR real
    .trim();
  return `${comQuebras}\n`;
};

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
  /**
   * SEM VALOR PADRÃO, de propósito. Já houve aqui o ID da planilha oficial como
   * fallback — bastava alguém ligar GOOGLE_SHEETS_ENABLED sem informar o ID para
   * a API começar a escrever na planilha de produção. O destino da escrita tem
   * de ser sempre uma decisão explícita de quem configura o ambiente.
   */
  GOOGLE_SHEETS_SPREADSHEET_ID: envVar('GOOGLE_SHEETS_SPREADSHEET_ID', ''),
  GOOGLE_SHEETS_BASE_TAB: envVar('GOOGLE_SHEETS_BASE_TAB', '(BASE) CADASTRO PRODUTOS'),
  GOOGLE_SHEETS_FISCAL_TAB: envVar('GOOGLE_SHEETS_FISCAL_TAB', '(TNP) FISCAL - DE PARA PRODUTOS'),
  GOOGLE_SHEETS_DEFAULT_LOJAS: envVar('GOOGLE_SHEETS_DEFAULT_LOJAS', 'TNP,LI,HORA'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: envVar('GOOGLE_SERVICE_ACCOUNT_EMAIL', ''),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: normalizePrivateKey(envVar('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', '')),
};

/** Só o que é preciso para saber ONDE escrever. */
export interface SheetsDestinoConfig {
  GOOGLE_SHEETS_SPREADSHEET_ID: string;
  GOOGLE_SHEETS_BASE_TAB: string;
}

/** Só o que é preciso para saber COMO autenticar. */
export interface SheetsCredenciaisConfig {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
}

const vazio = (v: string | undefined): boolean => (v ?? '').trim() === '';

/**
 * Variáveis de DESTINO ausentes. Enquanto essa lista não estiver vazia a
 * sincronização é recusada: sem destino explícito, não se escreve em lugar
 * nenhum. É o que impede a integração de cair de volta em alguma planilha
 * padrão por acidente.
 */
export const destinoSheetsFaltando = (cfg: SheetsDestinoConfig = env): string[] =>
  (['GOOGLE_SHEETS_SPREADSHEET_ID', 'GOOGLE_SHEETS_BASE_TAB'] as const).filter((k) => vazio(cfg[k]));

/** Credenciais ausentes. Reportadas pelo health; o cliente também se recusa a subir sem elas. */
export const credenciaisSheetsFaltando = (cfg: SheetsCredenciaisConfig = env): string[] =>
  (['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'] as const).filter((k) => vazio(cfg[k]));
