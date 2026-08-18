import { inject, injectable } from 'tsyringe';
import type { ProductSchemas } from '@pralis/shared';
import { env } from '@/config/env';
import { AppError } from '@/config/api.replies';
import type { Tx } from '@/db/databases';
import { ProductRepository } from '@/modules/product/product.repository';
import { ProductSheetRepository } from './product-sheet.repository';
import { SHEETS_GATEWAY } from './google-sheets.di';
import {
  a1, indexToCol,
  type SheetsGateway, type SheetMeta, type ValueRange,
} from './google-sheets.client';
import { mapProductToCells, INPUT_COLUMNS, type CellMap } from './product-sheet.mapper';

/**
 * ETAPA 1: espelha na planilha o produto criado na BASE.
 *
 * Princípios (não negociáveis):
 *  - o Postgres é a fonte principal; falha no Google NUNCA desfaz o cadastro;
 *  - a linha é localizada pelo UUID na coluna CP (idempotência), nunca só pelo
 *    row_number salvo — a planilha é editada por gente;
 *  - fórmulas/formatação/validações vêm da linha-modelo por copyPaste; depois
 *    escrevemos SOMENTE as colunas de entrada.
 */

type Product = ProductSchemas.ProductEntity;

/** Resultado de uma tentativa de sincronização (o que a API devolve para a tela). */
export type SheetSyncOutcome = 'synced' | 'failed' | 'disabled' | 'skipped';

export interface SyncResult {
  outcome: SheetSyncOutcome;
  rowNumber: number | null;
  message: string;
  error?: string;
}

export interface SheetsHealth {
  enabled: boolean;
  spreadsheetId: string;
  sheetName: string;
  auth: boolean;
  spreadsheetAcessivel: boolean;
  abaEncontrada: boolean;
  sheetId: number | null;
  cabecalhos: { coluna: string; esperado: string; encontrado: string; ok: boolean }[];
  cabecalhosOk: boolean;
  ok: boolean;
  erro?: string;
}

/** Primeira linha de produto da aba (linha 5 = cabeçalhos). */
export const FIRST_DATA_ROW = 11;
const HEADER_ROW = 5;

/** Cabeçalhos obrigatórios: se não baterem, a planilha mudou e NÃO gravamos nada. */
const REQUIRED_HEADERS = [
  { coluna: 'E', esperado: 'NOME' },
  { coluna: 'AC', esperado: 'CODIGO INT.' },
  { coluna: 'CP', esperado: 'ID' },
] as const;

/** Compara cabeçalho ignorando acento, caixa, espaço extra e ponto final. */
export const normalizeHeader = (v: string): string =>
  (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas de acento separadas pelo NFD
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '')
    .trim();

/** Nunca deixa credencial/token vazar para o banco ou para o log. */
export function sanitizeError(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return raw
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[credencial removida]')
    .replace(/(private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|bearer)\s*[=:]?\s*\S+/gi, '$1 [oculto]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[oculto]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

const isEmpty = (v: string | undefined): boolean => (v ?? '').trim() === '';

@injectable()
export class ProductSheetService {
  /**
   * Fila em processo: duas criações simultâneas não podem escolher a MESMA
   * primeira linha vazia. (Com várias instâncias da API isso não basta — ver
   * "riscos" no relatório de entrega.)
   */
  private fila: Promise<unknown> = Promise.resolve();

  /** sheetId real por título — resolvido uma vez por processo. */
  private sheetCache: SheetMeta | null = null;

  constructor(
    @inject(ProductRepository) private products: ProductRepository,
    @inject(ProductSheetRepository) private syncRepo: ProductSheetRepository,
    @inject(SHEETS_GATEWAY) private sheets: SheetsGateway,
  ) {}

  private get spreadsheetId(): string {
    return env.GOOGLE_SHEETS_SPREADSHEET_ID;
  }

  private get sheetName(): string {
    return env.GOOGLE_SHEETS_BASE_TAB;
  }

  get enabled(): boolean {
    return env.GOOGLE_SHEETS_ENABLED;
  }

  /**
   * Registra o produto como `pending` DENTRO da transação de criação.
   * Só produtos da BASE são espelhados nesta etapa.
   */
  async registerPending(productId: string, tx: Tx): Promise<void> {
    await this.syncRepo.ensurePending(
      { productId, spreadsheetId: this.spreadsheetId, sheetName: this.sheetName },
      tx,
    );
  }

  /**
   * Sincroniza um produto (idempotente). Nunca lança por causa do Google:
   * devolve `failed` e deixa o registro marcado para reprocessar.
   */
  async syncProduct(productId: string): Promise<SyncResult> {
    if (!this.enabled) {
      return { outcome: 'disabled', rowNumber: null, message: 'Integração com a planilha desligada (GOOGLE_SHEETS_ENABLED=false).' };
    }

    const product = await this.products.findById(productId);
    if (!product) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
    if (product.loja !== 'BASE') {
      return { outcome: 'skipped', rowNumber: null, message: 'Nesta etapa só o catálogo BASE é espelhado na planilha.' };
    }

    // garante o registro (produtos criados antes desta feature não têm linha)
    await this.syncRepo.ensurePending({
      productId,
      spreadsheetId: this.spreadsheetId,
      sheetName: this.sheetName,
    });

    return this.enfileirar(async () => {
      try {
        const rowNumber = await this.escrever(product);
        await this.syncRepo.markSynced(productId, rowNumber);
        return {
          outcome: 'synced' as const,
          rowNumber,
          message: `Produto espelhado na planilha (linha ${rowNumber}).`,
        };
      } catch (e) {
        const error = sanitizeError(e);
        await this.syncRepo.markFailed(productId, error).catch(() => {});
        return {
          outcome: 'failed' as const,
          rowNumber: null,
          message: 'Produto salvo no banco. Sincronização com a planilha pendente.',
          error,
        };
      }
    });
  }

  /** Checagem SOMENTE LEITURA: autenticação, acesso, aba e cabeçalhos. */
  async health(): Promise<SheetsHealth> {
    const base: SheetsHealth = {
      enabled: this.enabled,
      spreadsheetId: this.spreadsheetId,
      sheetName: this.sheetName,
      auth: false,
      spreadsheetAcessivel: false,
      abaEncontrada: false,
      sheetId: null,
      cabecalhos: [],
      cabecalhosOk: false,
      ok: false,
    };
    if (!this.enabled) return { ...base, erro: 'GOOGLE_SHEETS_ENABLED=false' };

    try {
      const abas = await this.sheets.getSheets(this.spreadsheetId);
      base.auth = true;
      base.spreadsheetAcessivel = true;

      const aba = abas.find((s) => s.title === this.sheetName);
      if (!aba) {
        return { ...base, erro: `Aba "${this.sheetName}" não encontrada na planilha.` };
      }
      this.sheetCache = aba;
      base.abaEncontrada = true;
      base.sheetId = aba.sheetId;

      const cabecalhos = await this.lerCabecalhos();
      base.cabecalhos = cabecalhos;
      base.cabecalhosOk = cabecalhos.every((c) => c.ok);
      base.ok = base.cabecalhosOk;
      if (!base.cabecalhosOk) base.erro = 'Cabeçalhos da linha 5 não conferem.';
      return base;
    } catch (e) {
      return { ...base, erro: sanitizeError(e) };
    }
  }

  // ---------------- internos ----------------

  /** Serializa as gravações para não haver disputa pela primeira linha vazia. */
  private enfileirar<T>(fn: () => Promise<T>): Promise<T> {
    const proxima = this.fila.then(fn, fn);
    this.fila = proxima.catch(() => undefined);
    return proxima;
  }

  private async resolverAba(): Promise<SheetMeta> {
    if (this.sheetCache) return this.sheetCache;
    const abas = await this.sheets.getSheets(this.spreadsheetId);
    const aba = abas.find((s) => s.title === this.sheetName);
    if (!aba) throw new Error(`Aba "${this.sheetName}" não encontrada na planilha.`);
    this.sheetCache = aba;
    return aba;
  }

  private async lerCabecalhos() {
    const ranges = REQUIRED_HEADERS.map((h) => a1(this.sheetName, `${h.coluna}${HEADER_ROW}`));
    const lidos = await this.sheets.batchGetValues(this.spreadsheetId, ranges, 'FORMATTED_VALUE');
    return REQUIRED_HEADERS.map((h, i) => {
      const encontrado = lidos[i]?.[0]?.[0] ?? '';
      return {
        coluna: h.coluna,
        esperado: h.esperado,
        encontrado,
        ok: normalizeHeader(encontrado) === normalizeHeader(h.esperado),
      };
    });
  }

  /** Grava o produto e devolve a linha usada. Lança em qualquer erro do Google. */
  private async escrever(product: Product): Promise<number> {
    const aba = await this.resolverAba();

    // 1 round-trip: cabeçalhos + coluna de IDs + coluna de nomes
    const ranges = [
      ...REQUIRED_HEADERS.map((h) => a1(this.sheetName, `${h.coluna}${HEADER_ROW}`)),
      a1(this.sheetName, `CP${FIRST_DATA_ROW}:CP`),
      a1(this.sheetName, `E${FIRST_DATA_ROW}:E`),
    ];
    const lido = await this.sheets.batchGetValues(this.spreadsheetId, ranges, 'FORMATTED_VALUE');

    // cabeçalhos: se mudaram, aborta ANTES de escrever qualquer coisa
    const cabecalhos = REQUIRED_HEADERS.map((h, i) => ({
      ...h,
      encontrado: lido[i]?.[0]?.[0] ?? '',
    }));
    const divergente = cabecalhos.find((c) => normalizeHeader(c.encontrado) !== normalizeHeader(c.esperado));
    if (divergente) {
      throw new Error(
        `Cabeçalho inesperado na linha ${HEADER_ROW}: coluna ${divergente.coluna} deveria ser "${divergente.esperado}" e está "${divergente.encontrado}".`,
      );
    }

    const colunaIds = (lido[REQUIRED_HEADERS.length] ?? []).map((r) => (r?.[0] ?? '').trim());
    const colunaNomes = (lido[REQUIRED_HEADERS.length + 1] ?? []).map((r) => (r?.[0] ?? '').trim());

    // 2) idempotência: a linha já existe? (busca pelo UUID em CP, nunca só pelo row_number)
    const existente = colunaIds.indexOf(product.id);
    const linhaExistente = existente >= 0 ? FIRST_DATA_ROW + existente : null;

    const linha = linhaExistente ?? this.primeiraLinhaLivre(colunaNomes, colunaIds);

    if (linhaExistente === null) {
      // reserva a linha ANTES de escrever: se a escrita falhar no meio, o retry
      // volta na mesma linha em vez de consumir outra.
      await this.syncRepo.setRowNumber(product.id, linha).catch(() => {});
      await this.prepararLinhaNova(aba, linha);
    }

    await this.gravarCelulas(product, linha);
    return linha;
  }

  /** Primeira linha com NOME (E) e ID (CP) vazios, a partir da linha 11. */
  private primeiraLinhaLivre(nomes: string[], ids: string[]): number {
    const total = Math.max(nomes.length, ids.length);
    for (let i = 0; i < total; i++) {
      if (isEmpty(nomes[i]) && isEmpty(ids[i])) return FIRST_DATA_ROW + i;
    }
    return FIRST_DATA_ROW + total;
  }

  /**
   * Prepara a linha nova copiando da linha ANTERIOR apenas:
   *  - formatação + validação de dados (PASTE_FORMAT) da linha inteira;
   *  - fórmulas (PASTE_FORMULA) somente nas colunas que de fato têm fórmula.
   * Nenhum valor manual e nenhum ID da linha-modelo é copiado.
   */
  private async prepararLinhaNova(aba: SheetMeta, linha: number): Promise<void> {
    const requests: unknown[] = [];

    // a grade precisa ter a linha
    if (aba.rowCount < linha) {
      requests.push({
        appendDimension: { sheetId: aba.sheetId, dimension: 'ROWS', length: linha - aba.rowCount + 1 },
      });
      aba.rowCount = linha + 1;
    }

    const modelo = linha - 1;
    if (modelo < FIRST_DATA_ROW) {
      // primeira linha de dados: não há de onde copiar; a aba já traz o formato
      if (requests.length) await this.sheets.batchUpdate(this.spreadsheetId, requests);
      return;
    }

    const ultimaColuna = indexToCol(Math.max(0, aba.columnCount - 1));
    const [modeloRow] = await this.sheets.batchGetValues(
      this.spreadsheetId,
      [a1(this.sheetName, `A${modelo}:${ultimaColuna}${modelo}`)],
      'FORMULA',
    );
    const celulasModelo = modeloRow?.[0] ?? [];

    const origem = (c0: number, c1: number) => ({
      sheetId: aba.sheetId,
      startRowIndex: modelo - 1,
      endRowIndex: modelo,
      startColumnIndex: c0,
      endColumnIndex: c1,
    });
    const destino = (c0: number, c1: number) => ({
      sheetId: aba.sheetId,
      startRowIndex: linha - 1,
      endRowIndex: linha,
      startColumnIndex: c0,
      endColumnIndex: c1,
    });

    // formatação + validações da linha inteira
    requests.push({
      copyPaste: {
        source: origem(0, aba.columnCount),
        destination: destino(0, aba.columnCount),
        pasteType: 'PASTE_FORMAT',
      },
    });

    // fórmulas: só nos trechos contíguos que realmente têm fórmula na linha-modelo
    for (const [c0, c1] of this.trechosDeFormula(celulasModelo)) {
      requests.push({
        copyPaste: {
          source: origem(c0, c1),
          destination: destino(c0, c1),
          pasteType: 'PASTE_FORMULA',
        },
      });
    }

    await this.sheets.batchUpdate(this.spreadsheetId, requests);
  }

  /** Índices [início, fim) das sequências de células que contêm fórmula. */
  private trechosDeFormula(linha: string[]): Array<[number, number]> {
    const trechos: Array<[number, number]> = [];
    let inicio = -1;
    for (let i = 0; i <= linha.length; i++) {
      const ehFormula = typeof linha[i] === 'string' && linha[i]!.startsWith('=');
      if (ehFormula && inicio === -1) inicio = i;
      if (!ehFormula && inicio !== -1) {
        trechos.push([inicio, i]);
        inicio = -1;
      }
    }
    return trechos;
  }

  /**
   * Escreve SOMENTE as colunas de entrada, uma range por coluna — nunca um
   * range corrido tipo C:CP, porque há colunas calculadas no meio.
   * Dois lotes: RAW (texto literal, preserva zero à esquerda) e USER_ENTERED
   * (números, hora e percentual que a planilha precisa interpretar).
   */
  private async gravarCelulas(product: Product, linha: number): Promise<void> {
    const cells: CellMap = mapProductToCells(product, {
      defaultLojas: env.GOOGLE_SHEETS_DEFAULT_LOJAS,
    });

    const raw: ValueRange[] = [];
    const userEntered: ValueRange[] = [];

    for (const col of INPUT_COLUMNS) {
      const cell = cells[col];
      if (!cell) continue;
      const range = a1(this.sheetName, `${col}${linha}`);
      if (cell.kind === 'text') raw.push({ range, values: [[cell.value]] });
      else if (cell.kind === 'number') userEntered.push({ range, values: [[cell.value]] });
      else if (cell.kind === 'entered') userEntered.push({ range, values: [[cell.value]] });
      else userEntered.push({ range, values: [['']] }); // limpa
    }

    await this.sheets.batchUpdateValues(this.spreadsheetId, userEntered, 'USER_ENTERED');
    await this.sheets.batchUpdateValues(this.spreadsheetId, raw, 'RAW');
  }
}
