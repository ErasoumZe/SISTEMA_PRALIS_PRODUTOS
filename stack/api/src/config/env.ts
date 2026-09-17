import 'dotenv/config';
import { SEGREDOS_DE_DESENVOLVIMENTO } from './segredos';

/** Lê uma env var tratando string vazia como ausente (compose injeta '' para ${VAR} não setada). */
const envVar = (key: string, fallback: string): string => {
  const v = process.env[key];
  return v != null && v.trim() !== '' ? v : fallback;
};

/** Número inteiro; texto que não é número cai no padrão em vez de virar `NaN`. */
const envNum = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v == null || v.trim() === '') return fallback;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : fallback;
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

  // Alguns painéis, inclusive a configuração atual do Coolify, achatam o PEM
  // trocando TODAS as quebras por espaços: "-----BEGIN...----- MIIE... -----END".
  // Reconstrói o envelope e o corpo base64 em linhas de 64 caracteres. Isso
  // também canonicaliza com segurança as formas com \n literal e quebra real.
  const partesPem = comQuebras.match(
    /^-----BEGIN ([A-Z0-9 ]+)-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END \1-----$/,
  );
  if (partesPem) {
    const [, tipo, corpoComEspacos] = partesPem;
    const corpo = corpoComEspacos!.replace(/\s+/g, '');
    const linhas = corpo.match(/.{1,64}/g) ?? [];
    return `-----BEGIN ${tipo}-----\n${linhas.join('\n')}\n-----END ${tipo}-----\n`;
  }

  return `${comQuebras}\n`;
};

/**
 * Configuração de ambiente. Mantida simples nesta fase.
 * NUNCA logar os valores de segredos (JWT, cookie, Cloudinary, Google).
 */
export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'dev',
  /**
   * Commit publicado. O Coolify expoe SOURCE_COMMIT; ficar vazio nao e erro,
   * so significa "nao da para saber por aqui".
   */
  BUILD_COMMIT: envVar('SOURCE_COMMIT', envVar('GIT_COMMIT_SHA', '')),
  PORT: Number(process.env.PORT ?? 3333),
  CORS_ORIGIN: envVar('CORS_ORIGIN', '*'),
  // Os padrões são de DESENVOLVIMENTO e estão no repositório. Em produção o
  // boot recusa (ver `segredos.ts`): quem conhece o padrão assina um token.
  JWT_SECRET: envVar('JWT_SECRET', SEGREDOS_DE_DESENVOLVIMENTO.JWT_SECRET),
  COOKIE_SECRET: envVar('COOKIE_SECRET', SEGREDOS_DE_DESENVOLVIMENTO.COOKIE_SECRET),
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
  /** Aba com os grupos oficiais e a margem padrao de cada um (colunas M e N). */
  GOOGLE_SHEETS_GRUPOS_TAB: envVar('GOOGLE_SHEETS_GRUPOS_TAB', '(TNP/LI/HORA - EXP.) GRUPOS/REF. - VLD SAIDA'),
  GOOGLE_SHEETS_DEFAULT_LOJAS: envVar('GOOGLE_SHEETS_DEFAULT_LOJAS', 'TNP,LI,HORA'),
  /**
   * Aba de cada loja no espelho, como JSON. Vazio usa o padrao do servico,
   * que cobre TNP e LI. HORA fica FORA de proposito: a aba existe e ja tem as
   * colunas, mas a loja nao entrou em nenhuma integracao ainda.
   */
  GOOGLE_SHEETS_LOJA_TABS: envVar('GOOGLE_SHEETS_LOJA_TABS', ''),
  /**
   * Espelho automatico nas abas de loja (TNP e LI) ao importar da BASE e ao
   * editar um produto de loja. DESLIGADO por padrao: fica assim ate o Jose
   * conferir a gravacao de 1 produto pela rota de previsualizacao.
   */
  GOOGLE_SHEETS_LOJA_ESPELHO_AUTO: envBool('GOOGLE_SHEETS_LOJA_ESPELHO_AUTO', false),
  /**
   * Prazo de cada chamada ao Google, em milissegundos. `0` desliga o relógio.
   *
   * Existe porque não havia prazo nenhum: uma leitura travada pendurava a
   * requisição HTTP até o navegador desistir, com o produto já salvo no banco.
   * 20 s é folgado para uma planilha saudável (as leituras equivalentes numa
   * planilha leve voltam em 300–500 ms) e curto o bastante para a pessoa no
   * balcão não ficar esperando: estourando, a linha vai para a fila de reenvio.
   */
  GOOGLE_SHEETS_TIMEOUT_MS: envNum('GOOGLE_SHEETS_TIMEOUT_MS', 20000),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: envVar('GOOGLE_SERVICE_ACCOUNT_EMAIL', ''),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: normalizePrivateKey(envVar('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', '')),

  // ---- Criare/SIA Supervisor (exportação posicional; nunca grava no Supervisor) ----
  CREARE_EXPORT_ENABLED: envBool('CREARE_EXPORT_ENABLED', false),
  /** JSON por loja. Sem fallback: de-para fiscal e defaults precisam ser decisão explícita. */
  CREARE_STORE_CONFIG_JSON: envVar('CREARE_STORE_CONFIG_JSON', ''),
  /**
   * Token para o robô da loja baixar o arquivo sem sessão web (o agendamento
   * das 22:30 roda sem ninguém logado). Sem fallback: ausente ou curto demais
   * deixa o download por máquina desabilitado, e só sessão de admin exporta.
   */
  CREARE_EXPORT_TOKEN: envVar('CREARE_EXPORT_TOKEN', ''),
  /**
   * Publicar o TXT do cadastro numa pasta do Google Drive a cada salvamento.
   *
   * Existe porque a máquina da loja vê a pasta do Drive montada (`H:\...`) e a
   * API não: ela roda em container, e `H:` só existe lá. Publicando no Drive, o
   * Drive para Desktop entrega o arquivo na loja sem nada agendado.
   */
  CREARE_DRIVE_ENABLED: envBool('CREARE_DRIVE_ENABLED', false),
  /**
   * `{"TNP":"<id da pasta>"}`. Sem fallback de propósito: publicar na pasta
   * errada entrega o cadastro de uma loja para outra, e o `coditem` do arquivo
   * grava por cima de produtos diferentes no PDV.
   *
   * A pasta precisa estar num **Drive compartilhado**. Conta de serviço não tem
   * cota de armazenamento: dentro de "Meu Drive" de alguém, mesmo compartilhado
   * como Editor, a criação falha com `storageQuotaExceeded`.
   */
  CREARE_DRIVE_FOLDERS_JSON: envVar('CREARE_DRIVE_FOLDERS_JSON', ''),

  /**
   * Pasta com os CSVs das fontes da unificação. Vazio cai em `../../docs`
   * relativo ao workspace da API — que é onde eles ficam no repositório e,
   * pelo Dockerfile, também na imagem.
   */
  UNIFICACAO_FONTES_DIR: envVar('UNIFICACAO_FONTES_DIR', ''),

  // ---- Ingestão de vendas pelo robô (TNP/Lisboa) ----
  // Sem fallback: token ausente deixa a autenticação de máquina desabilitada.
  VENDAS_IMPORT_TOKEN: envVar('VENDAS_IMPORT_TOKEN', ''),
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
