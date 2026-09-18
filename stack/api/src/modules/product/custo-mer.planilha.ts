import { inject, injectable } from 'tsyringe';
import { env } from '@/config/env';
import { SHEETS_GATEWAY } from '@/modules/google-sheets/google-sheets.di';
import { a1, indexToCol, type SheetsGateway } from '@/modules/google-sheets/google-sheets.client';
import type { LancamentoMer } from './custo-mer.motor';

/**
 * Leitura da aba de discriminação de mercadorias — **só leitura**.
 *
 * Cada linha é um lançamento de compra. O que interessa são três colunas:
 * `PRODUTOS`, `VALOR CUSTO UN` e `DATA REF`.
 */

export interface MerConfig {
  GOOGLE_SHEETS_MER_SPREADSHEET_ID: string;
  GOOGLE_SHEETS_MER_TAB: string;
  GOOGLE_SHEETS_MER_LINHA_FINAL: number;
}

export type EstadoMer = 'ok' | 'sem-destino' | 'sem-coluna' | 'falhou';

export interface LeituraMer {
  estado: EstadoMer;
  lancamentos: LancamentoMer[];
  /** Em que linha da aba o cabeçalho foi encontrado. */
  linhaCabecalho: number | null;
  descartados: number;
  faltando: string[];
  truncada: boolean;
  erro?: string;
}

const COLUNA_PRODUTO = 'PRODUTOS';
const COLUNA_CUSTO = 'VALOR CUSTO UN';
const COLUNA_DATA = 'DATA REF';

/** Até onde procurar o cabeçalho. A aba tem títulos e blocos mesclados em cima. */
const LINHAS_DE_CABECALHO = 30;

const normalizarTitulo = (valor: unknown): string => String(valor ?? '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replace(/\p{Cf}/gu, '')
  .toUpperCase()
  .replace(/\s+/g, ' ')
  .trim();

const vazio = (): LeituraMer => ({
  estado: 'ok', lancamentos: [], linhaCabecalho: null, descartados: 0, faltando: [], truncada: false,
});

@injectable()
export class CustoMerPlanilhaService {
  constructor(@inject(SHEETS_GATEWAY) private sheets: SheetsGateway) {}

  async ler(cfg: MerConfig = env): Promise<LeituraMer> {
    if (!cfg.GOOGLE_SHEETS_MER_SPREADSHEET_ID.trim()) return { ...vazio(), estado: 'sem-destino' };
    try {
      const cabecalho = await this.cabecalho(cfg);
      if ('faltando' in cabecalho) {
        return { ...vazio(), estado: 'sem-coluna', faltando: cabecalho.faltando };
      }
      return await this.dados(cfg, cabecalho);
    } catch (e: unknown) {
      return { ...vazio(), estado: 'falhou', erro: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Acha o cabeçalho PROCURANDO, não por linha fixa.
   *
   * A aba tem título, blocos mesclados e linhas de legenda antes da grade, e
   * esse topo muda quando alguém acrescenta um bloco. Fixar "a linha 303" faria
   * a leitura passar a ler outra coisa em silêncio no dia seguinte.
   */
  private async cabecalho(
    cfg: MerConfig,
  ): Promise<{ linha: number; produto: number; custo: number; data: number } | { faltando: string[] }> {
    const range = a1(cfg.GOOGLE_SHEETS_MER_TAB, `1:${LINHAS_DE_CABECALHO}`);
    const [linhas = []] = await this.sheets.batchGetValues(cfg.GOOGLE_SHEETS_MER_SPREADSHEET_ID, [range], 'FORMATTED_VALUE');

    for (let i = 0; i < linhas.length; i += 1) {
      const titulos = (linhas[i] ?? []).map(normalizarTitulo);
      const produto = titulos.indexOf(normalizarTitulo(COLUNA_PRODUTO));
      const custo = titulos.indexOf(normalizarTitulo(COLUNA_CUSTO));
      const data = titulos.indexOf(normalizarTitulo(COLUNA_DATA));
      if (produto >= 0 && custo >= 0 && data >= 0) {
        return { linha: i + 1, produto, custo, data };
      }
    }
    return { faltando: [COLUNA_PRODUTO, COLUNA_CUSTO, COLUNA_DATA] };
  }

  /** Uma faixa estreita por coluna — ver a mesma decisão em `codigo-cadastro.planilha`. */
  private async dados(
    cfg: MerConfig,
    cols: { linha: number; produto: number; custo: number; data: number },
  ): Promise<LeituraMer> {
    const primeira = cols.linha + 1;
    const campos = ['produto', 'custo', 'data'] as const;
    const ranges = campos.map((c) => a1(
      cfg.GOOGLE_SHEETS_MER_TAB,
      `${indexToCol(cols[c])}${primeira}:${indexToCol(cols[c])}${cfg.GOOGLE_SHEETS_MER_LINHA_FINAL}`,
    ));
    const blocos = await this.sheets.batchGetValues(cfg.GOOGLE_SHEETS_MER_SPREADSHEET_ID, ranges, 'FORMATTED_VALUE');
    const [produtos = [], custos = [], datas = []] = blocos;

    const altura = Math.max(produtos.length, custos.length, datas.length);
    const lancamentos: LancamentoMer[] = [];
    let descartados = 0;
    for (let i = 0; i < altura; i += 1) {
      const produto = String(produtos[i]?.[0] ?? '').trim();
      const custoUnitario = String(custos[i]?.[0] ?? '').trim();
      // linha sem produto é subtotal, separador ou sobra de fórmula
      if (!produto || !custoUnitario) { descartados += 1; continue; }
      lancamentos.push({
        linha: primeira + i,
        produto,
        custoUnitario,
        dataRef: String(datas[i]?.[0] ?? '').trim(),
      });
    }

    return {
      estado: 'ok',
      lancamentos,
      linhaCabecalho: cols.linha,
      descartados,
      faltando: [],
      truncada: altura >= cfg.GOOGLE_SHEETS_MER_LINHA_FINAL - primeira + 1,
    };
  }
}
