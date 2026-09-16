import { google } from 'googleapis';
import { env } from '@/config/env';
import { comPrazo } from './prazo';

/**
 * Costura fina sobre a API do Google Sheets. Existe para que o serviço de
 * sincronização seja testável sem rede: os testes injetam um duplo que
 * implementa `SheetsGateway`.
 *
 * REGRA: nenhuma credencial pode aparecer em log ou em mensagem de erro.
 */

export type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
export type ValueInputOption = 'RAW' | 'USER_ENTERED';

export interface SheetMeta {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

export interface ValueRange {
  range: string;
  values: unknown[][];
}

export interface SheetsGateway {
  /** Metadados das abas (sheetId real por título, tamanho da grade). */
  getSheets(spreadsheetId: string): Promise<SheetMeta[]>;
  /** Leitura em lote. Devolve, por range, a matriz de células (sempre string). */
  batchGetValues(
    spreadsheetId: string,
    ranges: string[],
    renderOption?: ValueRenderOption,
  ): Promise<string[][][]>;
  /** Escrita em lote de VALORES (não toca no formato/fórmula das outras colunas). */
  batchUpdateValues(
    spreadsheetId: string,
    data: ValueRange[],
    valueInputOption: ValueInputOption,
  ): Promise<void>;
  /** Requests estruturais (copyPaste de formato/fórmula, appendDimension). */
  batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<void>;
}

/** Escapa o título da aba para uso em notação A1: '(BASE) CADASTRO PRODUTOS'!E11 */
export const quoteSheetTitle = (title: string): string => `'${title.replace(/'/g, "''")}'`;

/** Range A1 já com a aba escapada. */
export const a1 = (title: string, range: string): string => `${quoteSheetTitle(title)}!${range}`;

/** O Sheets devolve '' para célula vazia; normaliza tudo para string. */
const toStringMatrix = (values: unknown[][] | undefined | null): string[][] =>
  (values ?? []).map((row) => (row ?? []).map((c) => (c == null ? '' : String(c))));

export class MissingGoogleCredentialsError extends Error {
  constructor() {
    super('Credenciais do Google não configuradas (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).');
    this.name = 'MissingGoogleCredentialsError';
  }
}

export class GoogleSheetsSobTesteError extends Error {
  constructor(operacao: string) {
    super(
      `Bloqueado: o cliente REAL do Google Sheets foi acionado dentro de um teste (${operacao}). `
      + 'Com GOOGLE_SHEETS_ENABLED=true no .env isso escreve na planilha de VERDADE. '
      + 'Injete um dublê de SheetsGateway em vez de resolver o cliente real.',
    );
    this.name = 'GoogleSheetsSobTesteError';
  }
}

/**
 * Estamos dentro de um teste?
 *
 * O Vitest define `VITEST` e, quando ninguém disse o contrário, `NODE_ENV=test`.
 * Os dois são olhados porque nenhum sozinho cobre todo jeito de rodar a suíte.
 */
const sobTeste = (): boolean => !!process.env.VITEST || process.env.NODE_ENV === 'test';

/** Implementação real, com conta de serviço (JWT). */
export class GoogleSheetsClient implements SheetsGateway {
  private client: ReturnType<typeof google.sheets> | null = null;

  constructor(
    private readonly clientEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private readonly privateKey = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    private readonly prazoMs = env.GOOGLE_SHEETS_TIMEOUT_MS,
  ) {}

  /**
   * Duas camadas de prazo, de propósito.
   *
   * O `timeout` do gaxios ABORTA o socket — é ele que impede a conexão de
   * ficar pendurada segurando recurso. O `comPrazo` é a rede de segurança para
   * o caso de a promessa não assentar mesmo assim (já aconteceu: chamada que
   * ficou mais de cinco minutos sem resolver nem rejeitar). Um sem o outro
   * deixa um buraco.
   *
   * `retry: false`: quando a planilha está lenta, repetir só multiplica a
   * espera e queima cota. Quem repete aqui é a fila de reenvio, com recuo
   * crescente — e ela sabe quando parar.
   */
  private async chamar<T>(operacao: string, fn: (opcoes: object) => Promise<T>): Promise<T> {
    /*
     * TRAVA DE PRODUÇÃO.
     *
     * Em 16/09/2026 a suíte de integração da unificação resolveu ESTE cliente
     * pelo container de injeção. Como o `.env` da máquina tem
     * `GOOGLE_SHEETS_ENABLED=true` apontando para a planilha oficial, cada
     * `unificar()` de teste gravou uma linha DE VERDADE nela: 123 linhas de
     * fixture ("ABACAXI UNID", "MASSA UM"...) no cadastro real, da 1335 à 1459.
     *
     * A trava mora AQUI, no cliente real, e não no serviço: os testes que
     * injetam um dublê de `SheetsGateway` continuam exercitando o serviço
     * inteiro, e quem tentar falar com o Google de verdade falha alto — em vez
     * de escrever calado em produção.
     */
    if (sobTeste()) throw new GoogleSheetsSobTesteError(operacao);
    const opcoes = this.prazoMs > 0 ? { timeout: this.prazoMs, retry: false } : {};
    return comPrazo(fn(opcoes), this.prazoMs, operacao);
  }

  private sheets() {
    if (this.client) return this.client;
    if (!this.clientEmail || !this.privateKey) throw new MissingGoogleCredentialsError();
    const auth = new google.auth.JWT({
      email: this.clientEmail,
      key: this.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.client = google.sheets({ version: 'v4', auth });
    return this.client;
  }

  async getSheets(spreadsheetId: string): Promise<SheetMeta[]> {
    const res = await this.chamar('lista de abas', (opcoes) => this.sheets().spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))',
    }, opcoes));
    return (res.data.sheets ?? []).map((s) => ({
      sheetId: s.properties?.sheetId ?? -1,
      title: s.properties?.title ?? '',
      rowCount: s.properties?.gridProperties?.rowCount ?? 0,
      columnCount: s.properties?.gridProperties?.columnCount ?? 0,
    }));
  }

  async batchGetValues(
    spreadsheetId: string,
    ranges: string[],
    renderOption: ValueRenderOption = 'UNFORMATTED_VALUE',
  ): Promise<string[][][]> {
    const res = await this.chamar(
      `leitura de ${ranges.length} faixa(s)`,
      (opcoes) => this.sheets().spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
        valueRenderOption: renderOption,
        dateTimeRenderOption: 'FORMATTED_STRING',
      }, opcoes),
    );
    const byRange = res.data.valueRanges ?? [];
    return ranges.map((_, i) => toStringMatrix(byRange[i]?.values as unknown[][] | undefined));
  }

  async batchUpdateValues(
    spreadsheetId: string,
    data: ValueRange[],
    valueInputOption: ValueInputOption,
  ): Promise<void> {
    if (data.length === 0) return;
    await this.chamar(
      `escrita de ${data.length} faixa(s)`,
      (opcoes) => this.sheets().spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption, data },
      }, opcoes),
    );
  }

  async batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<void> {
    if (requests.length === 0) return;
    await this.chamar(
      `${requests.length} operação(ões) estrutural(is)`,
      (opcoes) => this.sheets().spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: requests as never[] },
      }, opcoes),
    );
  }
}

// ---- utilitários de notação A1 ----

/** 'A' -> 0, 'Z' -> 25, 'AA' -> 26, 'CP' -> 93 */
export const colToIndex = (col: string): number => {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** 0 -> 'A', 26 -> 'AA' */
export const indexToCol = (index: number): string => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};
