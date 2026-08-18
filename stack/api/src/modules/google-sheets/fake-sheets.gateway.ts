import type {
  SheetsGateway, SheetMeta, ValueRange, ValueRenderOption, ValueInputOption,
} from './google-sheets.client';

/**
 * Planilha falsa em memória — usada SÓ nos testes. Nenhum teste automatizado
 * toca na planilha real.
 *
 * Simula o que importa para a sincronização:
 *  - leitura de célula, de coluna aberta (CP11:CP) e de linha (A20:CW20);
 *  - o Sheets corta linhas vazias no fim de uma coluna aberta;
 *  - escrita por range (RAW e USER_ENTERED);
 *  - copyPaste de fórmula (para a linha nova herdar as fórmulas da anterior).
 */
export class FakeSheetsGateway implements SheetsGateway {
  /** "E11" -> valor. */
  readonly cells = new Map<string, string>();
  readonly meta: SheetMeta;
  readonly writes: Array<{ range: string; value: unknown; option: ValueInputOption }> = [];
  readonly structuralRequests: unknown[] = [];
  /** Quando setado, toda chamada de escrita falha (simula queda do Google). */
  falharEscrita: Error | null = null;
  /** Quando setado, toda chamada falha (simula credencial inválida / rede). */
  falharTudo: Error | null = null;
  chamadas = { getSheets: 0, batchGet: 0, batchUpdateValues: 0, batchUpdate: 0 };

  constructor(meta?: Partial<SheetMeta>) {
    this.meta = {
      sheetId: 42,
      title: '(BASE) CADASTRO PRODUTOS',
      rowCount: 9930,
      columnCount: 101, // até CW
      ...meta,
    };
  }

  // ---- helpers de teste ----
  set(a1Cell: string, value: string): this {
    this.cells.set(a1Cell, value);
    return this;
  }

  get(a1Cell: string): string {
    return this.cells.get(a1Cell) ?? '';
  }

  /** Cabeçalhos válidos da linha 5. */
  comCabecalhos(): this {
    return this.set('E5', 'NOME').set('AC5', 'CODIGO INT.').set('CP5', 'ID');
  }

  /** Linha de produto já existente (nome + id + uma fórmula em H). */
  comProduto(row: number, nome: string, id: string): this {
    this.set(`E${row}`, nome).set(`CP${row}`, id);
    this.set(`H${row}`, `=E${row}&" "&F${row}&" "&G${row}`);
    this.set(`AO${row}`, `=ROUND(AJ${row}*AL${row},2)`);
    return this;
  }

  /** Conteúdo da linha inteira (para inspecionar o resultado do teste). */
  linha(row: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.cells) {
      const m = /^([A-Z]+)(\d+)$/.exec(k);
      if (m && Number(m[2]) === row && v !== '') out[m[1]!] = v;
    }
    return out;
  }

  // ---- SheetsGateway ----
  async getSheets(): Promise<SheetMeta[]> {
    this.chamadas.getSheets++;
    if (this.falharTudo) throw this.falharTudo;
    return [{ ...this.meta }, { sheetId: 43, title: '(TNP) CADASTRO PRODUTOS', rowCount: 100, columnCount: 101 }];
  }

  async batchGetValues(
    _spreadsheetId: string,
    ranges: string[],
    _render: ValueRenderOption = 'UNFORMATTED_VALUE',
  ): Promise<string[][][]> {
    this.chamadas.batchGet++;
    if (this.falharTudo) throw this.falharTudo;
    return ranges.map((r) => this.lerRange(r));
  }

  async batchUpdateValues(
    _spreadsheetId: string,
    data: ValueRange[],
    valueInputOption: ValueInputOption,
  ): Promise<void> {
    this.chamadas.batchUpdateValues++;
    if (this.falharTudo) throw this.falharTudo;
    if (this.falharEscrita) throw this.falharEscrita;
    for (const d of data) {
      const cell = this.semAba(d.range);
      const value = d.values?.[0]?.[0];
      this.writes.push({ range: cell, value, option: valueInputOption });
      this.cells.set(cell, value == null ? '' : String(value));
    }
  }

  async batchUpdate(_spreadsheetId: string, requests: unknown[]): Promise<void> {
    this.chamadas.batchUpdate++;
    if (this.falharTudo) throw this.falharTudo;
    if (this.falharEscrita) throw this.falharEscrita;
    for (const req of requests) {
      this.structuralRequests.push(req);
      this.aplicarCopyPaste(req);
    }
  }

  // ---- internos ----
  private semAba(range: string): string {
    const i = range.indexOf('!');
    return i >= 0 ? range.slice(i + 1) : range;
  }

  private lerRange(range: string): string[][] {
    const r = this.semAba(range);

    const celula = /^([A-Z]+)(\d+)$/.exec(r);
    if (celula) {
      const v = this.get(r);
      return v === '' ? [] : [[v]];
    }

    // coluna aberta: CP11:CP  (o Sheets corta as linhas vazias do fim)
    const colunaAberta = /^([A-Z]+)(\d+):([A-Z]+)$/.exec(r);
    if (colunaAberta) {
      const [, col, inicio] = colunaAberta;
      const start = Number(inicio);
      let ultima = start - 1;
      for (const [k, v] of this.cells) {
        const m = new RegExp(`^${col}(\\d+)$`).exec(k);
        if (m && v !== '' && Number(m[1]) >= start) ultima = Math.max(ultima, Number(m[1]));
      }
      const out: string[][] = [];
      for (let row = start; row <= ultima; row++) {
        const v = this.get(`${col}${row}`);
        out.push(v === '' ? [] : [v]);
      }
      return out;
    }

    // retângulo: A20:CW20
    const retangulo = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(r);
    if (retangulo) {
      const [, c0, r0, c1, r1] = retangulo;
      const out: string[][] = [];
      for (let row = Number(r0); row <= Number(r1); row++) {
        const linha: string[] = [];
        for (let c = colToIndex(c0!); c <= colToIndex(c1!); c++) {
          linha.push(this.get(`${indexToCol(c)}${row}`));
        }
        out.push(linha);
      }
      return out;
    }

    throw new Error(`FakeSheetsGateway: range não suportado "${range}"`);
  }

  /** Copia só o que o PASTE_FORMULA copiaria (as fórmulas do trecho). */
  private aplicarCopyPaste(req: unknown): void {
    const cp = (req as { copyPaste?: Record<string, unknown> }).copyPaste;
    if (!cp || cp.pasteType !== 'PASTE_FORMULA') return;
    const source = cp.source as { startRowIndex: number; startColumnIndex: number; endColumnIndex: number };
    const destination = cp.destination as { startRowIndex: number };
    const srcRow = source.startRowIndex + 1;
    const dstRow = destination.startRowIndex + 1;
    for (let c = source.startColumnIndex; c < source.endColumnIndex; c++) {
      const col = indexToCol(c);
      const v = this.get(`${col}${srcRow}`);
      if (v.startsWith('=')) {
        // referências relativas acompanham a linha, igual ao Sheets
        this.cells.set(`${col}${dstRow}`, v.replace(new RegExp(`([A-Z]+)${srcRow}\\b`, 'g'), `$1${dstRow}`));
      }
    }
  }
}

// duplicado local para o fake não depender do módulo do cliente real
const colToIndex = (col: string): number => {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const indexToCol = (index: number): string => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};
