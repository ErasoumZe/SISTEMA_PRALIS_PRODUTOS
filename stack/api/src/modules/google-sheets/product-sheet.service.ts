import { inject, injectable } from 'tsyringe';
import type { ProductSchemas } from '@pralis/shared';
import { env, destinoSheetsFaltando, credenciaisSheetsFaltando } from '@/config/env';
import { AppError } from '@/config/api.replies';
import type { Tx } from '@/db/databases';
import { ProductRepository } from '@/modules/product/product.repository';
import { ProductSheetRepository } from './product-sheet.repository';
import { SHEETS_GATEWAY } from './google-sheets.di';
import {
  a1, colToIndex, indexToCol,
  type SheetsGateway, type SheetMeta, type ValueRange,
} from './google-sheets.client';
import {
  mapProductToCells, inputColumnsFor,
  type CellMap, type SheetFooterColumns,
} from './product-sheet.mapper';

/**
 * ETAPA 1: espelha na planilha o produto criado na BASE.
 *
 * Princípios (não negociáveis):
 *  - o Postgres é a fonte principal; falha no Google NUNCA desfaz o cadastro;
 *  - a linha é localizada pelo UUID na coluna cujo cabeçalho é ID (idempotência), nunca só pelo
 *    row_number salvo — a planilha é editada por gente;
 *  - fórmulas/formatação/validações vêm da linha-modelo por copyPaste; depois
 *    escrevemos SOMENTE as colunas de entrada.
 */

type Product = ProductSchemas.ProductEntity;

/**
 * Resultado de uma tentativa de sincronização (o que a API devolve para a tela).
 * `misconfigured`: ligada, mas sem destino explícito — recusa antes de tocar no
 * Google. Nunca é o mesmo que `disabled`, para o erro de configuração não passar
 * despercebido como se fosse uma escolha.
 */
export type SheetSyncOutcome = 'synced' | 'failed' | 'disabled' | 'skipped' | 'misconfigured';

export interface SyncResult {
  outcome: SheetSyncOutcome;
  rowNumber: number | null;
  message: string;
  error?: string;
}

/**
 * Resultado de uma tentativa de APAGAR o produto da planilha.
 * `absent`: a linha não estava lá — não é erro, é a exclusão já refletida.
 */
export type SheetRemovalOutcome = 'removed' | 'absent' | 'failed' | 'disabled' | 'skipped' | 'misconfigured';

export interface RemovalResult {
  outcome: SheetRemovalOutcome;
  rowNumber: number | null;
  message: string;
  error?: string;
}

/**
 * Estrutura de UMA aba de cadastro, do ponto de vista do espelhamento.
 * Hoje só a BASE é espelhada; isto existe para mostrar, sem adivinhação, o que
 * falta em cada aba de loja antes de o espelhamento por loja ser possível.
 */
export interface AbaCadastroStatus {
  loja: string;
  titulo: string;
  encontrada: boolean;
  /** Quantos cabeçalhos preenchidos a linha 5 tem. */
  colunas: number;
  colunaId: string | null;
  colunaFoto: string | null;
  pronta: boolean;
  /** O que impede o espelhamento desta aba. Vazio = pronta. */
  faltando: string[];
}

export interface SheetsHealth {
  enabled: boolean;
  /** Nomes das variáveis ausentes — nunca os valores. */
  configFaltando: string[];
  configOk: boolean;
  spreadsheetId: string;
  sheetName: string;
  auth: boolean;
  spreadsheetAcessivel: boolean;
  abaEncontrada: boolean;
  sheetId: number | null;
  cabecalhos: { coluna: string; esperado: string; encontrado: string; ok: boolean }[];
  cabecalhosOk: boolean;
  /** Diagnóstico de TODAS as abas de cadastro (BASE + lojas). */
  abas: AbaCadastroStatus[];
  ok: boolean;
  erro?: string;
}

/** Catálogos que têm aba de cadastro na planilha. */
const CATALOGOS_COM_ABA = ['BASE', 'TNP', 'LI', 'HORA'] as const;

/**
 * Título da aba de cadastro de um catálogo. Só a BASE é configurável por env,
 * porque só ela é escrita — as demais entram apenas no diagnóstico.
 */
const abaDoCatalogo = (loja: string): string =>
  loja === 'BASE' ? env.GOOGLE_SHEETS_BASE_TAB : `(${loja}) CADASTRO PRODUTOS`;

/** Primeira linha de produto da aba (linha 5 = cabeçalhos). */
export const FIRST_DATA_ROW = 11;
const HEADER_ROW = 5;
/** Linha-modelo validada que contém o conjunto completo de fórmulas. */
const FORMULA_TEMPLATE_ROW = 12;
const REQUIRED_FORMULA_COLUMNS = [
  'H', 'U', 'AD', 'AF', 'AH', 'AK', 'AO', 'AP',
  'AR', 'AT', 'AV', 'AX', 'AY', 'BI', 'BJ', 'BR',
] as const;

/** Cabeçalhos obrigatórios: se não baterem, a planilha mudou e NÃO gravamos nada. */
const REQUIRED_FIXED_HEADERS = [
  { coluna: 'E', esperado: 'NOME' },
  { coluna: 'AC', esperado: 'CODIGO INT.' },
] as const;

interface SheetLayout {
  footer: SheetFooterColumns;
  cabecalhos: SheetsHealth['cabecalhos'];
}

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
  private layoutCache: SheetLayout | null = null;

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

  /** Ligada por configuração (pode estar ligada e mal configurada). */
  get enabled(): boolean {
    return env.GOOGLE_SHEETS_ENABLED;
  }

  /** Variáveis de destino que faltam. Vazio = pode escrever. */
  get destinoFaltando(): string[] {
    return destinoSheetsFaltando();
  }

  /** Ligada E com destino explícito: só assim a escrita é permitida. */
  get operacional(): boolean {
    return this.enabled && this.destinoFaltando.length === 0;
  }

  /**
   * Registra o produto como `pending` DENTRO da transação de criação.
   * Só produtos da BASE são espelhados nesta etapa.
   */
  async registerPending(productId: string, tx?: Tx): Promise<void> {
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
    // Ligada sem destino explícito: recusa ANTES de qualquer chamada ao Google.
    const faltando = this.destinoFaltando;
    if (faltando.length > 0) {
      return {
        outcome: 'misconfigured',
        rowNumber: null,
        message: `Integração ligada, mas sem destino configurado: ${faltando.join(', ')}. Nada foi escrito.`,
        error: `configuração incompleta: ${faltando.join(', ')}`,
      };
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

  /**
   * Apaga o produto da planilha LIMPANDO as colunas de entrada da linha dele.
   *
   * Por que limpar e não excluir a linha (`deleteDimension`):
   *  - excluir desloca todas as linhas de baixo, e a planilha tem fórmulas com
   *    referência absoluta e abas de loja que apontam para linhas fixas;
   *  - limpar mantém a grade estável e a linha volta a ser candidata em
   *    `primeiraLinhaLivre` (que exige NOME e ID vazios — as duas são colunas
   *    de entrada), então o próximo cadastro reaproveita o espaço sozinho.
   *
   * Por que só as colunas de entrada e não a linha inteira:
   *  - as fórmulas ficam. `FORMULA_TEMPLATE_ROW` (linha 12) é a linha-modelo de
   *    onde toda sincronização futura copia; limpar a linha inteira do produto
   *    que estivesse nela destruiria o modelo e derrubaria a integração toda.
   *
   * Nunca lança por causa do Google: devolve `failed` para quem chamou decidir.
   */
  async removeProduct(productId: string): Promise<RemovalResult> {
    if (!this.enabled) {
      return { outcome: 'disabled', rowNumber: null, message: 'Integração com a planilha desligada (GOOGLE_SHEETS_ENABLED=false).' };
    }
    const faltando = this.destinoFaltando;
    if (faltando.length > 0) {
      return {
        outcome: 'misconfigured',
        rowNumber: null,
        message: `Integração ligada, mas sem destino configurado: ${faltando.join(', ')}. Nada foi apagado.`,
        error: `configuração incompleta: ${faltando.join(', ')}`,
      };
    }

    const product = await this.products.findById(productId);
    if (!product) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
    if (product.loja !== 'BASE') {
      return { outcome: 'skipped', rowNumber: null, message: 'Nesta etapa só o catálogo BASE é espelhado na planilha.' };
    }

    // mesma fila da escrita: uma criação concorrente não pode tomar a linha
    // enquanto ela está sendo liberada, nem ler a coluna de IDs no meio disso.
    return this.enfileirar(async () => {
      try {
        const rowNumber = await this.limparLinha(product.id);
        if (rowNumber === null) {
          return { outcome: 'absent' as const, rowNumber: null, message: 'O produto não estava na planilha; nada a apagar.' };
        }
        return {
          outcome: 'removed' as const,
          rowNumber,
          message: `Produto apagado da planilha (linha ${rowNumber} liberada).`,
        };
      } catch (e) {
        const error = sanitizeError(e);
        await this.syncRepo.markFailed(productId, error).catch(() => {});
        return {
          outcome: 'failed' as const,
          rowNumber: null,
          message: 'Não foi possível apagar o produto da planilha.',
          error,
        };
      }
    });
  }

  /**
   * Localiza a linha pelo UUID na coluna ID e limpa as colunas de entrada.
   * Devolve a linha liberada, ou null se o produto não está na planilha.
   */
  private async limparLinha(productId: string): Promise<number | null> {
    const aba = await this.resolverAba();
    const layout = await this.resolverLayout(aba);
    const divergente = layout.cabecalhos.find((h) => !h.ok);
    if (divergente) {
      throw new Error(
        `Cabeçalho inesperado ou ausente na linha ${HEADER_ROW}: esperado "${divergente.esperado}".`,
      );
    }

    // a linha é achada pelo UUID, nunca pelo row_number salvo — a planilha é
    // editada por gente e as linhas se movem.
    const [colunaIds] = await this.sheets.batchGetValues(
      this.spreadsheetId,
      [a1(this.sheetName, `${layout.footer.id}${FIRST_DATA_ROW}:${layout.footer.id}`)],
      'FORMATTED_VALUE',
    );
    const ids = (colunaIds ?? []).map((r) => (r?.[0] ?? '').trim());
    const indice = ids.indexOf(productId);
    if (indice < 0) return null;
    const linha = FIRST_DATA_ROW + indice;

    const limpeza: ValueRange[] = inputColumnsFor(layout.footer).map((col) => ({
      range: a1(this.sheetName, `${col}${linha}`),
      values: [['']],
    }));
    await this.sheets.batchUpdateValues(this.spreadsheetId, limpeza, 'RAW');
    return linha;
  }

  /** Checagem SOMENTE LEITURA: configuração, autenticação, acesso, aba e cabeçalhos. */
  async health(): Promise<SheetsHealth> {
    // nomes de variáveis, nunca valores
    const configFaltando = [...this.destinoFaltando, ...credenciaisSheetsFaltando()];
    const base: SheetsHealth = {
      enabled: this.enabled,
      configFaltando,
      configOk: configFaltando.length === 0,
      spreadsheetId: this.spreadsheetId,
      sheetName: this.sheetName,
      auth: false,
      spreadsheetAcessivel: false,
      abaEncontrada: false,
      sheetId: null,
      cabecalhos: [],
      cabecalhosOk: false,
      abas: [],
      ok: false,
    };
    if (!this.enabled) return { ...base, erro: 'GOOGLE_SHEETS_ENABLED=false' };
    if (configFaltando.length > 0) {
      return { ...base, erro: `Configuração incompleta: ${configFaltando.join(', ')}` };
    }

    try {
      const abas = await this.sheets.getSheets(this.spreadsheetId);
      base.auth = true;
      base.spreadsheetAcessivel = true;

      // O diagnóstico das abas vem ANTES do resto: mesmo que a aba da BASE
      // esteja faltando, ele já mostra o que existe e o que falta em cada uma.
      base.abas = await this.diagnosticarAbas(abas);

      const aba = abas.find((s) => s.title === this.sheetName);
      if (!aba) {
        return { ...base, erro: `Aba "${this.sheetName}" não encontrada na planilha.` };
      }
      this.sheetCache = aba;
      base.abaEncontrada = true;
      base.sheetId = aba.sheetId;

      const cabecalhos = (await this.resolverLayout(aba)).cabecalhos;
      base.cabecalhos = cabecalhos;
      base.cabecalhosOk = cabecalhos.every((c) => c.ok);
      base.ok = base.cabecalhosOk;
      if (!base.cabecalhosOk) base.erro = 'Cabeçalhos da linha 5 não conferem.';
      return base;
    } catch (e) {
      return { ...base, erro: sanitizeError(e) };
    }
  }

  /**
   * SOMENTE LEITURA: lê a linha de cabeçalho de cada aba de cadastro e diz se
   * ela tem a estrutura que a sincronização exige (coluna ID para achar a linha
   * do produto, coluna FOTO, NOME em E e CODIGO INT. em AC).
   */
  private async diagnosticarAbas(abasDaPlanilha: SheetMeta[]): Promise<AbaCadastroStatus[]> {
    const resultado: AbaCadastroStatus[] = [];

    for (const loja of CATALOGOS_COM_ABA) {
      const titulo = abaDoCatalogo(loja);
      const meta = abasDaPlanilha.find((a) => a.title === titulo);
      if (!meta) {
        resultado.push({
          loja, titulo, encontrada: false, colunas: 0,
          colunaId: null, colunaFoto: null, pronta: false,
          faltando: ['aba não encontrada'],
        });
        continue;
      }

      const ultimaColuna = indexToCol(Math.max(0, meta.columnCount - 1));
      const [range] = await this.sheets.batchGetValues(
        this.spreadsheetId,
        [a1(titulo, `A${HEADER_ROW}:${ultimaColuna}${HEADER_ROW}`)],
        'FORMATTED_VALUE',
      );
      const headers = range?.[0] ?? [];
      const localizar = (nome: string): string | null => {
        const alvo = normalizeHeader(nome);
        const i = headers.findIndex((h) => normalizeHeader(h) === alvo);
        return i >= 0 ? indexToCol(i) : null;
      };

      const colunaId = localizar('ID');
      const colunaFoto = localizar('FOTO');
      const faltando: string[] = [];
      if (!colunaId) faltando.push('coluna ID');
      if (!colunaFoto) faltando.push('coluna FOTO');
      for (const fixo of REQUIRED_FIXED_HEADERS) {
        const encontrado = headers[colToIndex(fixo.coluna)] ?? '';
        if (normalizeHeader(encontrado) !== normalizeHeader(fixo.esperado)) {
          faltando.push(`${fixo.esperado} na coluna ${fixo.coluna}`);
        }
      }

      resultado.push({
        loja, titulo, encontrada: true,
        colunas: headers.filter((h) => (h ?? '').trim() !== '').length,
        colunaId, colunaFoto,
        pronta: faltando.length === 0,
        faltando,
      });
    }
    return resultado;
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

  private async resolverLayout(aba: SheetMeta): Promise<SheetLayout> {
    if (this.layoutCache) return this.layoutCache;
    const ultimaColuna = indexToCol(Math.max(0, aba.columnCount - 1));
    const [range] = await this.sheets.batchGetValues(
      this.spreadsheetId,
      [a1(this.sheetName, `A${HEADER_ROW}:${ultimaColuna}${HEADER_ROW}`)],
      'FORMATTED_VALUE',
    );
    const headers = range?.[0] ?? [];
    const encontrado = (coluna: string) => headers[colToIndex(coluna)] ?? '';
    const localizar = (nome: string): string | null => {
      const alvo = normalizeHeader(nome);
      const i = headers.findIndex((h) => normalizeHeader(h) === alvo);
      return i >= 0 ? indexToCol(i) : null;
    };
    const id = localizar('ID');
    const photo = localizar('FOTO');
    const help = localizar('HABILITAR AJUDA');
    const cabecalhos: SheetsHealth['cabecalhos'] = [
      ...REQUIRED_FIXED_HEADERS.map((h) => ({
        coluna: h.coluna,
        esperado: h.esperado,
        encontrado: encontrado(h.coluna),
        ok: normalizeHeader(encontrado(h.coluna)) === normalizeHeader(h.esperado),
      })),
      { coluna: id ?? '?', esperado: 'ID', encontrado: id ? encontrado(id) : '', ok: !!id },
      { coluna: photo ?? '?', esperado: 'FOTO', encontrado: photo ? encontrado(photo) : '', ok: !!photo },
    ];
    const layout = { footer: { id: id ?? '', photo: photo ?? '', help }, cabecalhos };
    // Um layout inválido não é cacheado: o health consegue explicar o problema
    // e uma correção feita na planilha passa a valer sem reiniciar a API.
    if (cabecalhos.every((h) => h.ok)) this.layoutCache = layout;
    return layout;
  }

  /** Grava o produto e devolve a linha usada. Lança em qualquer erro do Google. */
  private async escrever(product: Product): Promise<number> {
    const aba = await this.resolverAba();
    const layout = await this.resolverLayout(aba);
    const divergente = layout.cabecalhos.find((h) => !h.ok);
    if (divergente) {
      throw new Error(
        `Cabeçalho inesperado ou ausente na linha ${HEADER_ROW}: esperado "${divergente.esperado}".`,
      );
    }

    // 1 round-trip: coluna de IDs localizada pelo cabeçalho + nomes
    const ranges = [
      a1(this.sheetName, `${layout.footer.id}${FIRST_DATA_ROW}:${layout.footer.id}`),
      a1(this.sheetName, `E${FIRST_DATA_ROW}:E`),
    ];
    const lido = await this.sheets.batchGetValues(this.spreadsheetId, ranges, 'FORMATTED_VALUE');
    const colunaIds = (lido[0] ?? []).map((r) => (r?.[0] ?? '').trim());
    const colunaNomes = (lido[1] ?? []).map((r) => (r?.[0] ?? '').trim());

    // 2) idempotência: a linha já existe? (busca pelo UUID na coluna ID, nunca só pelo row_number)
    const existente = colunaIds.indexOf(product.id);
    const linhaExistente = existente >= 0 ? FIRST_DATA_ROW + existente : null;

    const linha = linhaExistente ?? this.primeiraLinhaLivre(colunaNomes, colunaIds);

    if (linhaExistente === null) {
      // A ordem aqui é o contrato desta função e não pode ser trocada:
      //
      // 1) GARANTIR CAPACIDADE. Escrever em linha que não existe na grade é erro
      //    de range no Sheets. Tem de vir antes de qualquer valor.
      await this.garantirCapacidade(aba, linha);

      // 2) RESERVAR gravando só o UUID na coluna ID. A partir daí a linha é
      //    inequivocamente deste produto: `primeiraLinhaLivre` exige nome e ID
      //    vazios, então nenhum outro cadastro a toma, e um retry a reencontra
      //    pelo próprio ID mesmo se o resto falhar no meio.
      await this.sheets.batchUpdateValues(
        this.spreadsheetId,
        [{ range: a1(this.sheetName, `${layout.footer.id}${linha}`), values: [[product.id]] }],
        'RAW',
      );

      // 3) registrar a linha só depois que a planilha aceitou a reserva
      await this.syncRepo.setRowNumber(product.id, linha).catch(() => {});

      // 4) formato e validações da linha anterior. As fórmulas são tratadas
      // separadamente abaixo, pois a linha anterior pode estar incompleta.
      await this.copiarEstrutura(aba, linha);
    }

    // 5) garante as fórmulas também em retries de uma linha já reservada. Isso
    // repara sincronizações interrompidas sem criar outra linha.
    await this.garantirFormulas(aba, linha);

    // 6) por fim, as células de entrada
    await this.gravarCelulas(product, linha, layout.footer);
    return linha;
  }

  /** Primeira linha com NOME e ID vazios, a partir da linha 11. */
  private primeiraLinhaLivre(nomes: string[], ids: string[]): number {
    const total = Math.max(nomes.length, ids.length);
    for (let i = 0; i < total; i++) {
      if (isEmpty(nomes[i]) && isEmpty(ids[i])) return FIRST_DATA_ROW + i;
    }
    return FIRST_DATA_ROW + total;
  }

  /**
   * ETAPA 1: garante que a linha EXISTE fisicamente na grade, acrescentando
   * exatamente as linhas que faltam — nunca uma a mais. Nenhum valor pode ser
   * escrito antes disto: `values.update` fora da grade é erro de range.
   */
  private async garantirCapacidade(aba: SheetMeta, linha: number): Promise<void> {
    if (aba.rowCount >= linha) return; // já cabe
    await this.sheets.batchUpdate(this.spreadsheetId, [
      { appendDimension: { sheetId: aba.sheetId, dimension: 'ROWS', length: linha - aba.rowCount } },
    ]);
    aba.rowCount = linha;
  }

  /**
   * ETAPA 4: copia da linha ANTERIOR apenas:
   *  - formatação (PASTE_FORMAT);
   *  - validação de dados (PASTE_DATA_VALIDATION) — requisição SEPARADA, porque
   *    a documentação do Sheets define PASTE_FORMAT como "paste the format only,
   *    EXCLUDING data validation". Sem esta segunda requisição a linha nova
   *    nasceria sem as listas suspensas;
   * Nenhum valor manual, fórmula ou ID da linha anterior é copiado aqui.
   */
  private async copiarEstrutura(aba: SheetMeta, linha: number): Promise<void> {
    const requests: unknown[] = [];

    const modelo = linha - 1;
    if (modelo < FIRST_DATA_ROW) {
      // primeira linha de dados: não há de onde copiar; a aba já traz o formato
      return;
    }

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

    // formatação da linha inteira...
    requests.push({
      copyPaste: {
        source: origem(0, aba.columnCount),
        destination: destino(0, aba.columnCount),
        pasteType: 'PASTE_FORMAT',
      },
    });

    // ...e as validações de dados, em requisição SEPARADA e OBRIGATÓRIA.
    // A documentação oficial define PASTE_FORMAT como "Paste the format only,
    // excluding data validation" — ou seja, ele NÃO traz as listas suspensas.
    // Sem esta segunda requisição, a linha nova nasceria sem os dropdowns de
    // grupo, setor, marca e % de desconto.
    requests.push({
      copyPaste: {
        source: origem(0, aba.columnCount),
        destination: destino(0, aba.columnCount),
        pasteType: 'PASTE_DATA_VALIDATION',
      },
    });

    await this.sheets.batchUpdate(this.spreadsheetId, requests);
  }

  /**
   * Copia somente as fórmulas que faltam, usando uma linha conhecida por conter
   * o modelo completo. A linha imediatamente anterior não é uma fonte segura:
   * ela pode ter sido incluída manualmente e estar parcialmente preenchida.
   */
  private async garantirFormulas(aba: SheetMeta, linha: number): Promise<void> {
    if (linha === FIRST_DATA_ROW || linha === FORMULA_TEMPLATE_ROW) return;

    const ultimaColuna = indexToCol(Math.max(0, aba.columnCount - 1));
    const [modeloRange, destinoRange] = await this.sheets.batchGetValues(
      this.spreadsheetId,
      [
        a1(this.sheetName, `A${FORMULA_TEMPLATE_ROW}:${ultimaColuna}${FORMULA_TEMPLATE_ROW}`),
        a1(this.sheetName, `A${linha}:${ultimaColuna}${linha}`),
      ],
      'FORMULA',
    );
    const modelo = modeloRange?.[0] ?? [];
    const destinoAtual = destinoRange?.[0] ?? [];

    const formulaAusenteNoModelo = REQUIRED_FORMULA_COLUMNS.find((coluna) => {
      const valor = modelo[colToIndex(coluna)];
      return typeof valor !== 'string' || !valor.startsWith('=');
    });
    if (formulaAusenteNoModelo) {
      throw new Error(
        `Linha-modelo ${FORMULA_TEMPLATE_ROW} incompleta: fórmula ausente na coluna ${formulaAusenteNoModelo}. Nada foi gravado nas células do produto.`,
      );
    }

    const faltantes = REQUIRED_FORMULA_COLUMNS
      .map(colToIndex)
      .filter((coluna) => {
        const valor = destinoAtual[coluna];
        return typeof valor !== 'string' || !valor.startsWith('=');
      });

    const origem = (c0: number, c1: number) => ({
      sheetId: aba.sheetId,
      startRowIndex: FORMULA_TEMPLATE_ROW - 1,
      endRowIndex: FORMULA_TEMPLATE_ROW,
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

    const requests = this.trechosContiguos(faltantes).map(([c0, c1]) => ({
      copyPaste: {
        source: origem(c0, c1),
        destination: destino(c0, c1),
        pasteType: 'PASTE_FORMULA',
      },
    }));
    await this.sheets.batchUpdate(this.spreadsheetId, requests);

    // A fórmula histórica de AP fixa $BB$11:$BH$11 e, por isso, consulta os
    // dias do primeiro produto. Para linhas sincronizadas pelo sistema, a faixa
    // deve ser a da própria linha.
    const [apRange] = await this.sheets.batchGetValues(
      this.spreadsheetId,
      [a1(this.sheetName, `AP${linha}`)],
      'FORMULA',
    );
    const formulaAp = apRange?.[0]?.[0] ?? '';
    if (formulaAp.startsWith('=')) {
      const corrigida = formulaAp.replace(
        /\$BB\$11:\$BH\$11/g,
        () => `$BB$${linha}:$BH$${linha}`,
      );
      if (corrigida !== formulaAp) {
        await this.sheets.batchUpdateValues(
          this.spreadsheetId,
          [{ range: a1(this.sheetName, `AP${linha}`), values: [[corrigida]] }],
          'USER_ENTERED',
        );
      }
    }
  }

  /** Índices [início, fim) das sequências de células que contêm fórmula. */
  private trechosContiguos(colunas: number[]): Array<[number, number]> {
    const trechos: Array<[number, number]> = [];
    for (const coluna of colunas) {
      const ultimo = trechos[trechos.length - 1];
      if (ultimo && ultimo[1] === coluna) ultimo[1] = coluna + 1;
      else trechos.push([coluna, coluna + 1]);
    }
    return trechos;
  }

  /**
   * Escreve SOMENTE as colunas de entrada, uma range por coluna — nunca um
   * range corrido tipo C:CP, porque há colunas calculadas no meio.
   * Dois lotes: RAW (texto literal, preserva zero à esquerda) e USER_ENTERED
   * (números, hora e percentual que a planilha precisa interpretar).
   */
  private async gravarCelulas(product: Product, linha: number, footer: SheetFooterColumns): Promise<void> {
    const cells: CellMap = mapProductToCells(product, {
      defaultLojas: env.GOOGLE_SHEETS_DEFAULT_LOJAS,
      footerColumns: footer,
    });

    const raw: ValueRange[] = [];
    const userEntered: ValueRange[] = [];

    for (const col of inputColumnsFor(footer)) {
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
