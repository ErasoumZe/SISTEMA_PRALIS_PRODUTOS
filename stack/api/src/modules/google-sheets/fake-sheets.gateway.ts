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
  /**
   * Log ORDENADO de tudo que saiu para o Sheets, na sequência real:
   * `appendDimension:+N`, `paste:PASTE_FORMAT`, `write:CP161`, ...
   * É o que permite provar que nenhum valor foi escrito antes da expansão
   * da grade.
   */
  readonly operacoes: string[] = [];
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
  /**
   * Células de ABAS específicas. Quando uma aba aparece aqui, ela passa a ter
   * o próprio mapa; qualquer outra continua usando `cells`. É o que permite
   * simular abas com layouts diferentes sem tocar nos testes já existentes.
   */
  readonly cellsPorAba = new Map<string, Map<string, string>>();

  set(a1Cell: string, value: string): this {
    this.cells.set(a1Cell, value);
    return this;
  }

  /** Define uma célula de uma aba específica (ex.: a aba da TNP). */
  setNaAba(titulo: string, a1Cell: string, value: string): this {
    let mapa = this.cellsPorAba.get(titulo);
    if (!mapa) { mapa = new Map(); this.cellsPorAba.set(titulo, mapa); }
    mapa.set(a1Cell, value);
    return this;
  }

  /** Registra uma aba que existe na planilha mas não tem cabeçalho nenhum. */
  comAbaVazia(titulo: string): this {
    if (!this.cellsPorAba.has(titulo)) this.cellsPorAba.set(titulo, new Map());
    return this;
  }

  get(a1Cell: string): string {
    return this.cells.get(a1Cell) ?? '';
  }

  /** Título da aba embutido no range A1 ('TITULO'!A5:C5), já sem as aspas. */
  private tituloDe(range: string): string | null {
    const i = range.indexOf('!');
    if (i < 0) return null;
    const bruto = range.slice(0, i);
    if (!bruto.startsWith("'")) return bruto;
    return bruto.slice(1, -1).split("''").join("'");
  }

  /** Mapa de células da aba — o próprio, se registrado; senão o compartilhado. */
  private mapaDe(titulo: string | null): Map<string, string> {
    if (titulo && this.cellsPorAba.has(titulo)) return this.cellsPorAba.get(titulo)!;
    return this.cells;
  }

  /** Cabeçalhos válidos da linha 5. */
  comCabecalhos(): this {
    return this
      .set('E5', 'NOME')
      .set('AC5', 'CODIGO INT.')
      .set('CN5', 'HABILITAR AJUDA')
      .set('CO5', 'FOTO')
      .set('CP5', 'ID');
  }

  /** Cabeçalhos da planilha oficial (179 colunas, até FW em 24/08/2026). */
  comCabecalhosOficiais(): this {
    return this
      .set('E5', 'NOME')
      .set('AC5', 'CODIGO INT.')
      .set('CP5', 'COMPRA ICMS-ST - VALOR')
      .set('FO5', 'FOTO')
      .set('FP5', 'ID');
  }

  /** Linha de produto já existente com o conjunto de fórmulas do modelo real. */
  comProduto(row: number, nome: string, id: string): this {
    this.set(`E${row}`, nome).set(`CP${row}`, id);
    return this.comLinhaModelo(row);
  }

  /** Conjunto completo de fórmulas, sem ocupar E/CP da linha. */
  comLinhaModelo(row: number): this {
    this.set(`H${row}`, `=E${row}&" "&F${row}&" "&G${row}`);
    this.set(`P${row}`, `=N${row}&" "&H${row}`);
    this.set(`U${row}`, `=IF(S${row}="SIM";H${row};"")`);
    this.set(`AD${row}`, `=IF(AB${row}<>"";P${row};"")`);
    this.set(`AF${row}`, `=AE${row}`);
    this.set(`AH${row}`, `=AG${row}`);
    this.set(`AK${row}`, `=IFERROR(R${row};"")`);
    this.set(`AO${row}`, `=ROUND(AJ${row}*AL${row},2)`);
    this.set(`AP${row}`, `=IFERROR(HLOOKUP(BI${row};$BB$11:$BH$11;1;0);AO${row})`);
    this.set(`AR${row}`, `=IFERROR(AQ${row};"")`);
    this.set(`AT${row}`, `=IFERROR(AS${row};"")`);
    this.set(`AV${row}`, `=AO${row}`);
    this.set(`AX${row}`, `=IFERROR(AW${row}/AO${row};0)`);
    this.set(`AY${row}`, `=(AZ${row}*AO${row})+AO${row}`);
    this.set(`BI${row}`, '=TODAY()');
    this.set(`BJ${row}`, '=NOW()');
    this.set(`BK${row}`, `=IF(BL${row}="";"";"DE")`);
    this.set(`BM${row}`, `=IF(BO${row}="";"";"ATÉ")`);
    this.set(`BR${row}`, `=IF(H${row}="";"";"SIM")`);
    return this;
  }

  /**
   * Tipos de colagem aplicados a uma linha (`PASTE_FORMAT`, `PASTE_FORMULA`,
   * `PASTE_DATA_VALIDATION`). Permite ao teste detectar a AUSÊNCIA de uma
   * requisição — por exemplo, uma linha nova criada sem validação de dados.
   */
  pasteTypes(row: number): string[] {
    const tipos = new Set<string>();
    for (const req of this.structuralRequests) {
      const cp = (req as { copyPaste?: Record<string, unknown> }).copyPaste;
      if (!cp) continue;
      const dst = cp.destination as { startRowIndex?: number } | undefined;
      if ((dst?.startRowIndex ?? -1) + 1 === row) tipos.add(String(cp.pasteType));
    }
    return [...tipos];
  }

  /** A linha nova recebeu formatação E validação de dados da linha-modelo? */
  temValidacaoDeDados(row: number): boolean {
    return this.pasteTypes(row).includes('PASTE_DATA_VALIDATION');
  }

  /** Linhas acrescentadas à grade por appendDimension (para conferir off-by-one). */
  linhasAcrescentadas(): number {
    let total = 0;
    for (const req of this.structuralRequests) {
      const ad = (req as { appendDimension?: { length?: number } }).appendDimension;
      if (ad?.length) total += ad.length;
    }
    return total;
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
      // escrever fora da grade é erro de range no Sheets — o fake reproduz isso
      const linha = Number(/(\d+)$/.exec(cell)?.[1] ?? 0);
      if (linha > this.meta.rowCount) {
        throw new Error(
          `Range ("${cell}") exceeds grid limits. Max rows: ${this.meta.rowCount}`,
        );
      }
      this.operacoes.push(`write:${cell}`);
      this.writes.push({ range: cell, value, option: valueInputOption });
      this.mapaDe(this.tituloDe(d.range)).set(cell, value == null ? '' : String(value));
    }
  }

  async batchUpdate(_spreadsheetId: string, requests: unknown[]): Promise<void> {
    this.chamadas.batchUpdate++;
    if (this.falharTudo) throw this.falharTudo;
    if (this.falharEscrita) throw this.falharEscrita;
    for (const req of requests) {
      this.structuralRequests.push(req);
      const ad = (req as { appendDimension?: { length?: number } }).appendDimension;
      if (ad?.length) {
        this.operacoes.push(`appendDimension:+${ad.length}`);
        this.meta.rowCount += ad.length; // a grade realmente cresce
      }
      const cp = (req as { copyPaste?: { pasteType?: string } }).copyPaste;
      if (cp?.pasteType) this.operacoes.push(`paste:${cp.pasteType}`);
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
    const mapa = this.mapaDe(this.tituloDe(range));
    const ler = (cell: string): string => mapa.get(cell) ?? '';

    const celula = /^([A-Z]+)(\d+)$/.exec(r);
    if (celula) {
      const v = ler(r);
      return v === '' ? [] : [[v]];
    }

    // coluna aberta: CP11:CP  (o Sheets corta as linhas vazias do fim)
    const colunaAberta = /^([A-Z]+)(\d+):([A-Z]+)$/.exec(r);
    if (colunaAberta) {
      const [, col, inicio] = colunaAberta;
      const start = Number(inicio);
      let ultima = start - 1;
      for (const [k, v] of mapa) {
        const m = new RegExp(`^${col}(\\d+)$`).exec(k);
        if (m && v !== '' && Number(m[1]) >= start) ultima = Math.max(ultima, Number(m[1]));
      }
      const out: string[][] = [];
      for (let row = start; row <= ultima; row++) {
        const v = ler(`${col}${row}`);
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
          linha.push(ler(`${indexToCol(c)}${row}`));
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
