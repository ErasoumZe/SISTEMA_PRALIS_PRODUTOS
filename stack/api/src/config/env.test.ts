import { describe, it, expect } from 'vitest';
import { normalizePrivateKey, destinoSheetsFaltando, credenciaisSheetsFaltando, env } from './env';

/**
 * A chave da conta de serviço chega de formas diferentes conforme o painel:
 * em uma linha só com `\n` literal (Coolify), com quebras reais (arquivo .env
 * multilinha), entre aspas, ou com CRLF (copiada no Windows).
 *
 * A versão anterior usava `.replace(/\n/g, '\n')` — regex de quebra REAL —,
 * então a forma mais comum (uma linha com `\n` literal) passava intacta e a
 * autenticação falhava com erro opaco. Estes testes travam isso.
 */

const MIOLO = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ';
const PEM_REAL = `-----BEGIN PRIVATE KEY-----\n${MIOLO}\n-----END PRIVATE KEY-----\n`;

describe('normalizePrivateKey', () => {
  it('converte "\\n" LITERAL em quebra de linha real (caso do Coolify)', () => {
    const umaLinhaSo = `-----BEGIN PRIVATE KEY-----\\n${MIOLO}\\n-----END PRIVATE KEY-----\\n`;

    // a entrada não tem nenhuma quebra real...
    expect(umaLinhaSo.includes('\n')).toBe(false);

    const saida = normalizePrivateKey(umaLinhaSo);

    expect(saida).toBe(PEM_REAL);
    expect(saida.split('\n')).toHaveLength(4); // 3 linhas + quebra final
    expect(saida).not.toContain('\\n'); // nenhuma sequência literal sobrou
  });

  it('não corrompe uma chave que JÁ tem quebras reais', () => {
    expect(normalizePrivateKey(PEM_REAL)).toBe(PEM_REAL);
  });

  it('reconstrói o PEM quando o painel troca todas as quebras por espaços', () => {
    const achatada = `-----BEGIN PRIVATE KEY----- ${MIOLO} -----END PRIVATE KEY-----`;
    expect(normalizePrivateKey(achatada)).toBe(PEM_REAL);
  });

  it('é idempotente (normalizar duas vezes não muda nada)', () => {
    const umaVez = normalizePrivateKey(`-----BEGIN PRIVATE KEY-----\\n${MIOLO}\\n-----END PRIVATE KEY-----`);
    expect(normalizePrivateKey(umaVez)).toBe(umaVez);
  });

  it('remove aspas envolventes quando o par casa', () => {
    expect(normalizePrivateKey(`"${PEM_REAL}"`)).toBe(PEM_REAL);
    expect(normalizePrivateKey(`'${PEM_REAL}'`)).toBe(PEM_REAL);
  });

  it('não remove aspas soltas que fazem parte do valor', () => {
    const soAbre = normalizePrivateKey(`"-----BEGIN PRIVATE KEY-----\\n${MIOLO}`);
    expect(soAbre.startsWith('"-----BEGIN')).toBe(true);
  });

  it('converte "\\r\\n" literal e CRLF real em quebra simples', () => {
    const literalCrlf = `-----BEGIN PRIVATE KEY-----\\r\\n${MIOLO}\\r\\n-----END PRIVATE KEY-----`;
    expect(normalizePrivateKey(literalCrlf)).toBe(PEM_REAL);

    const crlfReal = `-----BEGIN PRIVATE KEY-----\r\n${MIOLO}\r\n-----END PRIVATE KEY-----`;
    expect(normalizePrivateKey(crlfReal)).toBe(PEM_REAL);
    expect(normalizePrivateKey(crlfReal)).not.toContain('\r');
  });

  it('garante exatamente uma quebra no fim', () => {
    expect(normalizePrivateKey(`${PEM_REAL}\n\n\n`)).toBe(PEM_REAL);
    expect(normalizePrivateKey(`-----BEGIN PRIVATE KEY-----\\n${MIOLO}\\n-----END PRIVATE KEY-----`)).toBe(PEM_REAL);
  });

  it('valor ausente continua vazio (não vira "\\n" e não engana o cliente)', () => {
    expect(normalizePrivateKey('')).toBe('');
    expect(normalizePrivateKey('   ')).toBe('');
    expect(normalizePrivateKey('""')).toBe('');
  });

  it('o resultado é um PEM que o Node consegue interpretar', async () => {
    // prova de ponta: chave RSA de verdade, serializada em uma linha com \n literal
    const { generateKeyPairSync, createPrivateKey } = await import('node:crypto');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const comoVemDoPainel = pem.split('\n').join('\\n');
    expect(comoVemDoPainel.includes('\n')).toBe(false);

    const normalizada = normalizePrivateKey(comoVemDoPainel);
    expect(() => createPrivateKey(normalizada)).not.toThrow();

    const achatada = pem.replace(/\r?\n/g, ' ').trim();
    expect(() => createPrivateKey(normalizePrivateKey(achatada))).not.toThrow();
  });
});

/**
 * O destino da escrita NÃO pode ter valor padrão. Já houve aqui o ID da planilha
 * oficial como fallback: bastava ligar GOOGLE_SHEETS_ENABLED sem informar o ID
 * para a API escrever em produção. Estes testes travam isso.
 */
describe('configuração do Sheets — destino obrigatório', () => {
  it('NÃO existe ID de planilha embutido no CÓDIGO como padrão', async () => {
    // Invariante de código, não de ambiente: o valor em runtime depende do .env
    // de cada máquina, então checar `env.GOOGLE_SHEETS_SPREADSHEET_ID === ''`
    // seria um teste que passa ou falha conforme quem roda. O que precisa ser
    // garantido é que a FONTE não traz nenhum ID embutido — foi assim que o ID
    // da planilha oficial virou fallback.
    const { readFileSync } = await import('node:fs');
    const fonte = readFileSync(new URL('./env.ts', import.meta.url), 'utf8');

    const linha = fonte
      .split('\n')
      .find((l) => l.includes('GOOGLE_SHEETS_SPREADSHEET_ID:'));
    expect(linha, 'linha da variável não encontrada em env.ts').toBeTruthy();
    // o default tem de ser string vazia
    expect(linha).toContain("envVar('GOOGLE_SHEETS_SPREADSHEET_ID', '')");

    // e nenhum literal com cara de ID do Drive pode existir em env.ts. Um ID de
    // planilha tem ~44 caracteres misturando maiúscula, minúscula e dígito —
    // padrão que nomes de variável (tudo maiúsculo) e placeholders de dev
    // (tudo minúsculo) não satisfazem.
    const idDoDrive = /'(?=[^']*[a-z])(?=[^']*[A-Z])(?=[^']*\d)[A-Za-z0-9_-]{40,}'/g;
    const suspeitos = fonte.match(idDoDrive) ?? [];
    expect(suspeitos, `literais com cara de ID do Drive em env.ts: ${suspeitos.join(', ')}`).toEqual([]);
  });

  it('spreadsheet ID ausente => configuração recusada', () => {
    const faltando = destinoSheetsFaltando({
      GOOGLE_SHEETS_SPREADSHEET_ID: '',
      GOOGLE_SHEETS_BASE_TAB: '(BASE) CADASTRO PRODUTOS',
    });
    expect(faltando).toEqual(['GOOGLE_SHEETS_SPREADSHEET_ID']);
  });

  it('spreadsheet ID só com espaços também é recusado', () => {
    expect(
      destinoSheetsFaltando({
        GOOGLE_SHEETS_SPREADSHEET_ID: '   ',
        GOOGLE_SHEETS_BASE_TAB: '(BASE) CADASTRO PRODUTOS',
      }),
    ).toContain('GOOGLE_SHEETS_SPREADSHEET_ID');
  });

  it('aba ausente também é recusada', () => {
    expect(
      destinoSheetsFaltando({
        GOOGLE_SHEETS_SPREADSHEET_ID: 'id-da-copia',
        GOOGLE_SHEETS_BASE_TAB: '',
      }),
    ).toEqual(['GOOGLE_SHEETS_BASE_TAB']);
  });

  it('destino completo => aceito', () => {
    expect(
      destinoSheetsFaltando({
        GOOGLE_SHEETS_SPREADSHEET_ID: 'id-da-copia',
        GOOGLE_SHEETS_BASE_TAB: '(BASE) CADASTRO PRODUTOS',
      }),
    ).toEqual([]);
  });

  it('credenciais ausentes são reportadas pelo nome, nunca pelo valor', () => {
    const faltando = credenciaisSheetsFaltando({
      GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: '',
    });
    expect(faltando).toEqual(['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY']);

    const comCreds = credenciaisSheetsFaltando({
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'conta@projeto.iam.gserviceaccount.com',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    });
    expect(comCreds).toEqual([]);
  });
});
