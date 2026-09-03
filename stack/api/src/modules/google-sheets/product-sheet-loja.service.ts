import { inject, injectable } from 'tsyringe';
import type { ProductSchemas } from '@pralis/shared';
import { env } from '@/config/env';
import { AppError } from '@/config/api.replies';
import { SHEETS_GATEWAY } from './google-sheets.di';
import { a1, type SheetMeta, type SheetsGateway } from './google-sheets.client';
import { mapProductToCells, type CellMap, type SheetCell } from './product-sheet.mapper';
import {
  cabecalhosPorColuna,
  colunasPorCabecalho,
  conferirAbaDeDestino,
  traduzirCelulas,
} from './sheet-traducao';

type Product = ProductSchemas.ProductEntity;

/**
 * Lojas espelhadas. HORA fica DE FORA de propósito — a aba existe e tem as
 * colunas, mas a loja não entrou em nenhuma integração ainda.
 */
export const LOJAS_ESPELHADAS = ['TNP', 'LI'] as const;
export type LojaEspelhada = (typeof LOJAS_ESPELHADAS)[number];

const LINHA_CABECALHO = 5;
const PRIMEIRA_LINHA_DADOS = 11;

/** Aba de cada loja. HORA não está aqui: é o que a mantém desligada. */
const ABA_PADRAO: Record<LojaEspelhada, string> = {
  TNP: '(TNP) CADASTRO PRODUTOS',
  LI: '(LI) CADASTRO PRODUTOS',
};

/** Como terminou o espelho automatico de um lote. Nunca lanca: o cadastro ja valeu. */
export type EspelhoLojaResultado = 'desligado' | 'sem-aba' | 'espelhado' | 'falhou';

export interface CelulaPrevista {
  coluna: string;
  valor: string;
}

/** O que a gravação FARIA, sem fazer. */
export interface PrevisaoEspelho {
  loja: LojaEspelhada;
  aba: string;
  produtoId: string;
  linha: number;
  /** `true` = reservaria uma linha nova; `false` = atualizaria a que já é dele. */
  novaLinha: boolean;
  celulas: CelulaPrevista[];
  /** Campos que a BASE tem e esta aba não: não são gravados. */
  semCorrespondencia: string[];
  /** Colunas auxiliares da BASE sem cabeçalho: não há como casar por nome. */
  semCabecalho: string[];
}

const colunaPorIndice = (i: number): string => (i < 26
  ? String.fromCharCode(65 + i)
  : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

const vazio = (v: string | undefined): boolean => (v ?? '').trim() === '';

const comoTexto = (c: SheetCell): string => {
  if (c.kind === 'empty') return '';
  return String((c as { value: unknown }).value ?? '');
};

/**
 * Espelho do cadastro nas abas de LOJA.
 *
 * Separado do espelho da BASE de propósito: as abas não têm o mesmo leiaute. Na
 * planilha de produção, das 62 colunas em comum entre a BASE e a aba TNP, **61
 * estão em posição diferente** — por isso o casamento é por NOME de cabeçalho
 * (`sheet-traducao.ts`), nunca por posição.
 *
 * A linha é sempre localizada pelo `ID` (UUID do produto). Sem isso, cada
 * sincronismo criaria uma linha nova para o mesmo produto, e a aba viraria uma
 * pilha de cópias em vez de um cadastro.
 */
@injectable()
export class ProductSheetLojaService {
  constructor(@inject(SHEETS_GATEWAY) private sheets: SheetsGateway) {}

  private get spreadsheetId(): string {
    return env.GOOGLE_SHEETS_SPREADSHEET_ID;
  }

  /** Aba configurada para a loja, ou nada quando a loja não é espelhada. */
  abaDaLoja(loja: string): string | null {
    if (!(LOJAS_ESPELHADAS as readonly string[]).includes(loja)) return null;
    const configurado = env.GOOGLE_SHEETS_LOJA_TABS.trim();
    if (!configurado) return ABA_PADRAO[loja as LojaEspelhada];
    try {
      const json = JSON.parse(configurado) as Record<string, string>;
      const aba = json[loja]?.trim();
      return aba || null; // aba vazia na config = loja desligada
    } catch {
      // configuração inválida não pode fazer o espelho escrever no lugar errado
      return null;
    }
  }

  /** Cabeçalhos da BASE (origem) e da aba da loja (destino). */
  private async layouts(aba: string) {
    const faixas = [
      a1(env.GOOGLE_SHEETS_BASE_TAB, `A${LINHA_CABECALHO}:GZ${LINHA_CABECALHO}`),
      a1(aba, `A${LINHA_CABECALHO}:GZ${LINHA_CABECALHO}`),
    ];
    const lido = await this.sheets.batchGetValues(this.spreadsheetId, faixas, 'FORMATTED_VALUE');
    const origem = cabecalhosPorColuna(((lido[0] ?? [])[0] ?? []) as string[], colunaPorIndice);
    const destino = colunasPorCabecalho(((lido[1] ?? [])[0] ?? []) as string[], colunaPorIndice);

    const conferencia = conferirAbaDeDestino(destino);
    if (!conferencia.pronta) {
      throw new AppError(
        `A aba "${aba}" não pode receber o espelho: falta a coluna ${conferencia.faltando.join(' e ')} `
        + `na linha ${LINHA_CABECALHO}. Sem ID o espelho criaria uma linha nova a cada sincronismo.`,
        503,
        'SHEET_LOJA_SEM_ID',
      );
    }
    return { origem, destino, colunaId: destino.get('ID')! };
  }

  /**
   * A linha do produto: a que já tem o ID dele, ou a primeira REALMENTE livre.
   *
   * "Livre" não pode ser só `ID` e `NOME` vazios. Essas duas colunas acabaram de
   * ser criadas e estão vazias em TODAS as linhas anteriores ao espelho — a
   * primeira conferência mostrou o espelho querendo gravar na linha 11, em cima
   * de uma linha que já tinha código de barras e código interno. Uma linha só
   * está livre quando nenhuma das colunas de identidade que a aba já usa tem
   * conteúdo.
   */
  private async localizar(aba: string, destino: Map<string, string>, produtoId: string) {
    const colunaId = destino.get('ID')!;
    // colunas que uma linha ocupada preenche; as que a aba não tiver são ignoradas
    const ocupacao = ['NOME', 'CODIGO BARRAS', 'CODIGO INT.', 'CADASTRO PRODUTOS ATUALIZADO NOVO']
      .map((nome) => destino.get(nome))
      .filter((c): c is string => !!c);

    const colunas = [colunaId, ...ocupacao];
    const lido = await this.sheets.batchGetValues(
      this.spreadsheetId,
      colunas.map((c) => a1(aba, `${c}${PRIMEIRA_LINHA_DADOS}:${c}`)),
      'FORMATTED_VALUE',
    );
    const porColuna = colunas.map((_, i) => (lido[i] ?? []).map((r) => (r?.[0] ?? '').trim()));
    const ids = porColuna[0] ?? [];

    const existente = ids.indexOf(produtoId);
    if (existente >= 0) return { linha: PRIMEIRA_LINHA_DADOS + existente, novaLinha: false };

    const total = Math.max(...porColuna.map((c) => c.length), 0);
    for (let i = 0; i < total; i += 1) {
      if (porColuna.every((coluna) => vazio(coluna[i]))) {
        return { linha: PRIMEIRA_LINHA_DADOS + i, novaLinha: true };
      }
    }
    return { linha: PRIMEIRA_LINHA_DADOS + total, novaLinha: true };
  }

  private traduzir(product: Product, origem: Map<string, string>, destino: Map<string, string>) {
    const daBase: CellMap = mapProductToCells(product, {
      defaultLojas: env.GOOGLE_SHEETS_DEFAULT_LOJAS,
    });
    return traduzirCelulas(daBase, origem, destino);
  }

  /**
   * O que a gravação faria — sem gravar nada.
   *
   * Existe para conferir com UM produto antes de liberar o espelho geral: ver
   * célula por célula antes vale mais que desfazer depois, ainda mais porque a
   * aba é editada à mão pela loja.
   */
  async previsualizar(product: Product, loja: LojaEspelhada): Promise<PrevisaoEspelho> {
    const aba = this.abaDaLoja(loja);
    if (!aba) {
      throw new AppError(`A loja ${loja} não tem espelho configurado.`, 503, 'SHEET_LOJA_NAO_CONFIGURADA');
    }
    const { origem, destino } = await this.layouts(aba);
    const { linha, novaLinha } = await this.localizar(aba, destino, product.id);
    const traducao = this.traduzir(product, origem, destino);

    return {
      loja,
      aba,
      produtoId: product.id,
      linha,
      novaLinha,
      celulas: Object.entries(traducao.celulas)
        .map(([coluna, celula]) => ({ coluna, valor: comoTexto(celula) }))
        .sort((a, b) => a.coluna.length - b.coluna.length || a.coluna.localeCompare(b.coluna)),
      semCorrespondencia: traducao.semCorrespondencia,
      semCabecalho: traducao.semCabecalho,
    };
  }

  /**
   * Grava o produto na aba da loja.
   *
   * A ordem importa e é a mesma do espelho da BASE:
   *  1. garantir que a linha existe na grade (escrever fora dela é erro de range);
   *  2. reservar gravando SÓ o ID — a partir daí a linha é inequivocamente deste
   *     produto, e um retry a reencontra pelo próprio ID;
   *  3. gravar o resto.
   */
  async espelhar(product: Product, loja: LojaEspelhada): Promise<PrevisaoEspelho> {
    const plano = await this.previsualizar(product, loja);
    const abas = await this.sheets.getSheets(this.spreadsheetId);
    const meta = abas.find((a) => a.title === plano.aba);
    if (!meta) throw new AppError(`Aba "${plano.aba}" não encontrada.`, 503, 'SHEET_LOJA_ABA_AUSENTE');

    const { colunaId } = await this.layouts(plano.aba);

    if (plano.novaLinha) {
      await this.garantirCapacidade(meta, plano.linha);
      await this.sheets.batchUpdateValues(
        this.spreadsheetId,
        [{ range: a1(plano.aba, `${colunaId}${plano.linha}`), values: [[product.id]] }],
        'RAW',
      );
    }

    // RAW para texto (preserva zero à esquerda) e USER_ENTERED para o que a
    // planilha precisa interpretar — mesma divisão do espelho da BASE.
    const daBase = mapProductToCells(product, { defaultLojas: env.GOOGLE_SHEETS_DEFAULT_LOJAS });
    const { origem, destino } = await this.layouts(plano.aba);
    const { celulas } = traduzirCelulas(daBase, origem, destino);

    const raw: Array<{ range: string; values: string[][] }> = [];
    const interpretado: Array<{ range: string; values: string[][] }> = [];
    for (const [coluna, celula] of Object.entries(celulas)) {
      const range = a1(plano.aba, `${coluna}${plano.linha}`);
      if (celula.kind === 'text') raw.push({ range, values: [[String(celula.value)]] });
      else interpretado.push({ range, values: [[comoTexto(celula)]] });
    }
    if (raw.length) await this.sheets.batchUpdateValues(this.spreadsheetId, raw, 'RAW');
    if (interpretado.length) {
      await this.sheets.batchUpdateValues(this.spreadsheetId, interpretado, 'USER_ENTERED');
    }

    return plano;
  }

  /**
   * Espelha VÁRIOS produtos de uma loja de uma vez.
   *
   * Em lote de propósito: produto a produto, importar 500 itens seriam 1.500
   * chamadas ao Google e a cota estouraria muito antes do fim. Aqui é 1 leitura
   * de leiaute + 1 leitura de ocupação + 2 escritas, para o lote inteiro.
   *
   * Nunca lança. O produto já está salvo no Postgres quando isto roda, e uma
   * falha do Google não pode desfazer nem esconder o cadastro — foi assim que a
   * API entrou em loop de restart uma vez.
   */
  async espelharVarios(produtos: Product[], loja: LojaEspelhada): Promise<EspelhoLojaResultado> {
    if (!env.GOOGLE_SHEETS_LOJA_ESPELHO_AUTO) return 'desligado';
    if (produtos.length === 0) return 'espelhado';
    const aba = this.abaDaLoja(loja);
    if (!aba) return 'sem-aba';

    try {
      const { origem, destino } = await this.layouts(aba);
      const colunaId = destino.get('ID')!;
      const ocupacao = await this.ocupacao(aba, destino);

      const raw: Array<{ range: string; values: string[][] }> = [];
      const interpretado: Array<{ range: string; values: string[][] }> = [];
      let maiorLinha = PRIMEIRA_LINHA_DADOS;

      for (const produto of produtos) {
        const linha = ocupacao.linhaPara(produto.id);
        maiorLinha = Math.max(maiorLinha, linha);
        // o ID não vem do mapa da BASE: é escrito à parte, e em RAW para o UUID
        // não ser reinterpretado pela planilha
        raw.push({ range: a1(aba, `${colunaId}${linha}`), values: [[produto.id]] });
        const { celulas } = this.traduzir(produto, origem, destino);
        for (const [coluna, celula] of Object.entries(celulas)) {
          const range = a1(aba, `${coluna}${linha}`);
          if (celula.kind === 'text') raw.push({ range, values: [[String(celula.value)]] });
          else interpretado.push({ range, values: [[comoTexto(celula)]] });
        }
      }

      const abas = await this.sheets.getSheets(this.spreadsheetId);
      const meta = abas.find((a) => a.title === aba);
      if (meta) await this.garantirCapacidade(meta, maiorLinha);

      if (raw.length) await this.sheets.batchUpdateValues(this.spreadsheetId, raw, 'RAW');
      if (interpretado.length) {
        await this.sheets.batchUpdateValues(this.spreadsheetId, interpretado, 'USER_ENTERED');
      }
      return 'espelhado';
    } catch {
      return 'falhou';
    }
  }

  /**
   * Estado das linhas da aba, lido UMA vez, para o lote inteiro decidir em
   * memória. Sem isto, cada produto releria a coluna toda e dois produtos novos
   * do mesmo lote receberiam a MESMA linha livre — um sobrescrevendo o outro.
   */
  private async ocupacao(aba: string, destino: Map<string, string>) {
    const colunas = [
      destino.get('ID')!,
      ...['NOME', 'CODIGO BARRAS', 'CODIGO INT.', 'CADASTRO PRODUTOS ATUALIZADO NOVO']
        .map((nome) => destino.get(nome))
        .filter((c): c is string => !!c),
    ];
    const lido = await this.sheets.batchGetValues(
      this.spreadsheetId,
      colunas.map((c) => a1(aba, `${c}${PRIMEIRA_LINHA_DADOS}:${c}`)),
      'FORMATTED_VALUE',
    );
    const porColuna = colunas.map((_, i) => (lido[i] ?? []).map((r) => (r?.[0] ?? '').trim()));
    const ids = porColuna[0] ?? [];
    const total = Math.max(...porColuna.map((c) => c.length), 0);

    const linhaDoId = new Map<string, number>();
    ids.forEach((id, i) => { if (id) linhaDoId.set(id, PRIMEIRA_LINHA_DADOS + i); });

    const livres: number[] = [];
    for (let i = 0; i < total; i += 1) {
      if (porColuna.every((coluna) => vazio(coluna[i]))) livres.push(PRIMEIRA_LINHA_DADOS + i);
    }
    let proximaDoFim = PRIMEIRA_LINHA_DADOS + total;
    let usadas = 0;

    return {
      linhaPara(produtoId: string): number {
        const dele = linhaDoId.get(produtoId);
        if (dele !== undefined) return dele; // já tem linha: atualiza a dele
        const livre = livres[usadas];
        usadas += 1;
        if (livre !== undefined) { linhaDoId.set(produtoId, livre); return livre; }
        const nova = proximaDoFim;
        proximaDoFim += 1;
        linhaDoId.set(produtoId, nova);
        return nova;
      },
    };
  }

  /** Acrescenta só as linhas que faltam — escrever fora da grade é erro de range. */
  private async garantirCapacidade(aba: SheetMeta, linha: number): Promise<void> {
    if (aba.rowCount >= linha) return;
    await this.sheets.batchUpdate(this.spreadsheetId, [
      { appendDimension: { sheetId: aba.sheetId, dimension: 'ROWS', length: linha - aba.rowCount } },
    ]);
    aba.rowCount = linha;
  }
}
