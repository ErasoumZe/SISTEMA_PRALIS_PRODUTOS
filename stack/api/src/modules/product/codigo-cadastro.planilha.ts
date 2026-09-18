import { inject, injectable } from 'tsyringe';
import { env } from '@/config/env';
import { SHEETS_GATEWAY } from '@/modules/google-sheets/google-sheets.di';
import { a1, indexToCol, type SheetsGateway } from '@/modules/google-sheets/google-sheets.client';
import { codigoCadastroValido } from './codigo-cadastro.motor';
/**
 * Uma linha útil da aba MIX.
 *
 * A planilha entra aqui só como TETO da numeração (e, depois, como fonte dos
 * atributos na importação). Quem decide o código de cada produto é o de-para do
 * SIA — ver `codigo-cadastro.motor.ts`.
 */
export interface LinhaMix {
  linha: number;
  codigo: string;
  codigoBarras: string | null;
  nome: string;
}

/**
 * Leitura da planilha MIX — a régua da numeração de cadastro.
 *
 * SÓ LEITURA, e isso é regra, não detalhe: esta planilha é a fonte da
 * numeração. Se o sistema escrevesse nela, passaria a conferir o próprio
 * palpite contra ele mesmo. Quem escreve é a planilha oficial, pela coluna AC,
 * no caminho que já existia.
 */

export interface MixConfig {
  GOOGLE_SHEETS_MIX_SPREADSHEET_ID: string;
  GOOGLE_SHEETS_MIX_TAB: string;
  GOOGLE_SHEETS_MIX_LINHA_CABECALHO: number;
  GOOGLE_SHEETS_MIX_LINHA_INICIAL: number;
  GOOGLE_SHEETS_MIX_LINHA_FINAL: number;
}

export type EstadoMix = 'ok' | 'sem-destino' | 'sem-coluna' | 'falhou';

export interface LeituraMix {
  estado: EstadoMix;
  linhas: LinhaMix[];
  /** Maior código de cadastro visto. É daqui que sai o próximo a cunhar. */
  teto: number;
  /** Linhas puladas por não terem código — legendas, totais, linhas em branco. */
  descartadas: number;
  /** Títulos que o cabeçalho não tinha, quando o estado é `sem-coluna`. */
  faltando: string[];
  /** Mensagem do Google, quando o estado é `falhou`. */
  erro?: string;
}

const COLUNA_CODIGO = 'COD INTERNO';
const COLUNA_NOME = 'DESCRIÇÃO';
const COLUNA_BARRAS = 'COD BARRA 1';

const normalizarTitulo = (valor: unknown): string => String(valor ?? '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toUpperCase()
  .replace(/\s+/g, ' ')
  .trim();

const vazio = (): LeituraMix => ({ estado: 'ok', linhas: [], teto: 0, descartadas: 0, faltando: [] });

@injectable()
export class CodigoCadastroPlanilhaService {
  constructor(@inject(SHEETS_GATEWAY) private sheets: SheetsGateway) {}

  async ler(cfg: MixConfig = env): Promise<LeituraMix> {
    if (!cfg.GOOGLE_SHEETS_MIX_SPREADSHEET_ID.trim()) {
      return { ...vazio(), estado: 'sem-destino' };
    }
    try {
      const cabecalho = await this.cabecalho(cfg);
      if ('faltando' in cabecalho) return { ...vazio(), estado: 'sem-coluna', faltando: cabecalho.faltando };
      return await this.dados(cfg, cabecalho);
    } catch (e: unknown) {
      return { ...vazio(), estado: 'falhou', erro: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Acha as colunas pelo TÍTULO, não por posição fixa. A aba tem 248 colunas e
   * ganha colunas novas com frequência; travar em "Z" faria a leitura passar a
   * ler outra coisa em silêncio no dia em que alguém inserisse uma coluna.
   */
  private async cabecalho(cfg: MixConfig): Promise<{ codigo: number; nome: number; barras: number } | { faltando: string[] }> {
    const range = a1(cfg.GOOGLE_SHEETS_MIX_TAB, `A${cfg.GOOGLE_SHEETS_MIX_LINHA_CABECALHO}:IV${cfg.GOOGLE_SHEETS_MIX_LINHA_CABECALHO}`);
    const [linhas = []] = await this.sheets.batchGetValues(cfg.GOOGLE_SHEETS_MIX_SPREADSHEET_ID, [range], 'FORMATTED_VALUE');
    const titulos = (linhas[0] ?? []).map(normalizarTitulo);
    /*
     * Comparação EXATA: a aba tem `DESCRIÇÃO COMPLETA`, `DESCRIÇÃO PLACAS` e
     * `DESCRIÇÃO EXTRAIR` ao lado de `DESCRIÇÃO`, e `COD CESTA`/`COD INT` ao
     * lado de `COD INTERNO`. Busca por prefixo pegaria a coluna errada.
     */
    const achar = (titulo: string) => titulos.indexOf(normalizarTitulo(titulo));
    const codigo = achar(COLUNA_CODIGO);
    const nome = achar(COLUNA_NOME);
    const barras = achar(COLUNA_BARRAS);
    const faltando = [
      [COLUNA_CODIGO, codigo] as const,
      [COLUNA_NOME, nome] as const,
      [COLUNA_BARRAS, barras] as const,
    ].filter(([, i]) => i < 0).map(([t]) => t);
    return faltando.length ? { faltando } : { codigo, nome, barras };
  }

  private async dados(cfg: MixConfig, cols: { codigo: number; nome: number; barras: number }): Promise<LeituraMix> {
    const primeira = Math.min(cols.codigo, cols.nome, cols.barras);
    const ultima = Math.max(cols.codigo, cols.nome, cols.barras);
    const range = a1(
      cfg.GOOGLE_SHEETS_MIX_TAB,
      `${indexToCol(primeira)}${cfg.GOOGLE_SHEETS_MIX_LINHA_INICIAL}:${indexToCol(ultima)}${cfg.GOOGLE_SHEETS_MIX_LINHA_FINAL}`,
    );
    const [celulas = []] = await this.sheets.batchGetValues(cfg.GOOGLE_SHEETS_MIX_SPREADSHEET_ID, [range], 'FORMATTED_VALUE');

    const linhas: LinhaMix[] = [];
    let descartadas = 0;
    let teto = 0;
    celulas.forEach((celula, i) => {
      const em = (coluna: number) => String(celula[coluna - primeira] ?? '').trim();
      const codigo = em(cols.codigo).replace(/\D/g, '');
      /*
       * Fora da faixa do PDV não é código: é código de barras digitado na
       * coluna errada — o mesmo erro de campo que o PR #62 documentou. Deixar
       * passar faria o teto virar a casa dos trilhões e a próxima cunhagem
       * sair de lá.
       */
      if (!codigoCadastroValido(codigo)) { descartadas += 1; return; }
      const numero = Number(codigo);
      if (numero > teto) teto = numero;
      linhas.push({
        linha: cfg.GOOGLE_SHEETS_MIX_LINHA_INICIAL + i,
        codigo,
        codigoBarras: em(cols.barras) || null,
        nome: em(cols.nome),
      });
    });
    return { estado: 'ok', linhas, teto, descartadas, faltando: [] };
  }
}
