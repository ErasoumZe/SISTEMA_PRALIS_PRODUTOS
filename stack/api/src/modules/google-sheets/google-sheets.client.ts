import { google } from 'googleapis';
import { env } from '@/config/env';

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

/** Implementação real, com conta de serviço (JWT). */
export class GoogleSheetsClient implements SheetsGateway {
  private client: ReturnType<typeof google.sheets> | null = null;

  constructor(
    private readonly clientEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private readonly privateKey = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  ) {}

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
    const res = await this.sheets().spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))',
    });
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
    const res = await this.sheets().spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
      valueRenderOption: renderOption,
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const byRange = res.data.valueRanges ?? [];
    return ranges.map((_, i) => toStringMatrix(byRange[i]?.values as unknown[][] | undefined));
  }

  async batchUpdateValues(
    spreadsheetId: string,
    data: ValueRange[],
    valueInputOption: ValueInputOption,
  ): Promise<void> {
    if (data.length === 0) return;
    await this.sheets().spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption, data },
    });
  }

  async batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<void> {
    if (requests.length === 0) return;
    await this.sheets().spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: requests as never[] },
    });
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
