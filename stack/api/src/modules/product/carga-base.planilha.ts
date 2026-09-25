import { inject, injectable } from 'tsyringe';
import { env } from '@/config/env';
import { SHEETS_GATEWAY } from '@/modules/google-sheets/google-sheets.di';
import { a1, colToIndex, indexToCol, type SheetsGateway } from '@/modules/google-sheets/google-sheets.client';

/**
 * Leitura da planilha para a CARGA DA BASE.
 *
 * **SÓ LEITURA.** Nada aqui escreve na planilha.
 *
 * Fonte: aba `(TNP/LI) CADASTRO PRODUTOS` da planilha oficial
 * (`GOOGLE_SHEETS_SPREADSHEET_ID`), nas colunas que o José mapeou em
 * 25/09/2026 — C, D, F, H, M, X, Z, AB, AE, AH e HX. Palavras dele: *"elas são
 * as certas, tudo que está nelas foi trazido do banco do SIA"*. Por isso a
 * leitura não vai a outra aba atrás de nada: uma segunda fonte para o mesmo
 * campo é uma segunda verdade, e o dia em que as duas discordassem ninguém
 * saberia qual valeu.
 *
 * ### Por que por LETRA, e o que protege disso
 *
 * As letras é que são a decisão do José. Só que ler por posição cega é o pior
 * defeito possível aqui: uma coluna inserida faz a importação gravar custo no
 * campo de preço **sem erro nenhum**, e o banco aceita calado. Por isso cada
 * letra carrega o título que foi MEDIDO nela, e a leitura para antes de
 * produzir uma linha sequer se algum título deixar de bater.
 */

export interface CargaConfig {
  GOOGLE_SHEETS_SPREADSHEET_ID: string;
  GOOGLE_SHEETS_CARGA_TAB: string;
  GOOGLE_SHEETS_CARGA_LINHA_CABECALHO: number;
  GOOGLE_SHEETS_CARGA_LINHA_INICIAL: number;
  GOOGLE_SHEETS_CARGA_LINHA_FINAL: number;
}

/** Uma linha da aba, crua. Quem interpreta é o motor. */
export interface LinhaCarga {
  linha: number;
  /** `C` — ATIVO / INATIVO. A situação que o produto tem que ter ao entrar. */
  situacao: string;
  /** `D` — a descrição do produto. */
  nome: string;
  /** `F` — código de barras; quase sempre é o próprio código interno. */
  codigoBarras: string;
  /** `H` — unidade de medida: UN, KG, LT. */
  unidade: string;
  /** `M` — nome do grupo de mercadoria. */
  grupo: string;
  /** `X` — código interno, o `coditem` do PDV. É a chave da linha. */
  codigo: string;
  /** `Z` / `AB` — estoque mínimo e máximo. */
  estoqueMin: string;
  estoqueMax: string;
  /** `AE` — custo. */
  custo: string;
  /** `AH` — preço de venda digitado. AJ, AK e AQ são fórmulas em cima dele. */
  precoVenda: string;
  /** `HX` — id do grupo no Creare/SIA. Vai no `groupCode` do layout. */
  grupoId: string;
}

export type EstadoCarga = 'ok' | 'sem-destino' | 'coluna-mudou' | 'falhou';

export interface ColunaTrocada {
  coluna: string;
  esperado: string;
  encontrado: string;
}

export interface LeituraCarga {
  estado: EstadoCarga;
  linhas: LinhaCarga[];
  /**
   * Letra da coluna `ID` da aba, ou `null` quando a aba não tem uma.
   *
   * É por ela que o resto do sistema descobre em que linha mora cada produto.
   * A carga não escreve o cadastro na planilha, mas PRECISA carimbar esta
   * coluna — sem o carimbo, importar da Base para a loja abre linha nova em vez
   * de preencher a linha que o produto já ocupa.
   */
  colunaId: string | null;
  /** Linhas da janela sem nome — rodapé, sobra de fórmula, vazio. */
  descartadas: number;
  /** Cabeçalhos que deixaram de bater. Havendo um, nada é lido. */
  trocadas: ColunaTrocada[];
  /** A janela encheu: pode haver produto além dela. */
  truncada: boolean;
  erro?: string;
}

/**
 * As colunas do José, cada uma com o título medido nela em 25/09/2026.
 *
 * `titulo` vazio quer dizer "não dá para conferir pelo título". É o caso da
 * `C`, cujo cabeçalho é a letra solta `V`, que não identifica nada. Essa
 * coluna é conferida pelo CONTEÚDO em `carga-base.motor`, o que aqui é mais
 * firme: ou os valores são ATIVO e INATIVO, ou não é esta a coluna.
 */
export const COLUNAS_CARGA = {
  situacao: { letra: 'C', titulo: '' },
  nome: { letra: 'D', titulo: 'CADASTRO PRODUTOS ATUALIZADO NOVO' },
  codigoBarras: { letra: 'F', titulo: 'CODIGO BARRAS' },
  unidade: { letra: 'H', titulo: 'EMB' },
  grupo: { letra: 'M', titulo: 'GRUPO MERCADORIAS (REVENDA)' },
  codigo: { letra: 'X', titulo: 'CODIGO INT.' },
  estoqueMin: { letra: 'Z', titulo: 'ESTOQUE MIN' },
  estoqueMax: { letra: 'AB', titulo: 'ESTOQUE MAX' },
  custo: { letra: 'AE', titulo: 'CUSTO' },
  precoVenda: { letra: 'AH', titulo: 'V. VENDA PONTUAL' },
  grupoId: { letra: 'HX', titulo: 'ID GRUPO' },
} as const;

type Campo = keyof typeof COLUNAS_CARGA;
const CAMPOS = Object.keys(COLUNAS_CARGA) as Campo[];

const normalizar = (valor: unknown): string => String(valor ?? '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toUpperCase()
  .replace(/\s+/g, ' ')
  .trim();

const texto = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

const vazia = (): LeituraCarga => ({
  estado: 'ok', linhas: [], colunaId: null, descartadas: 0, trocadas: [], truncada: false,
});

/** Título da coluna em que o sistema guarda o identificador do produto. */
const TITULO_COLUNA_ID = 'ID';

@injectable()
export class CargaBasePlanilhaService {
  constructor(@inject(SHEETS_GATEWAY) private sheets: SheetsGateway) {}

  async ler(cfg: CargaConfig = env): Promise<LeituraCarga> {
    if (!cfg.GOOGLE_SHEETS_SPREADSHEET_ID.trim()) return { ...vazia(), estado: 'sem-destino' };
    try {
      const { trocadas, colunaId } = await this.conferirCabecalho(cfg);
      if (trocadas.length) return { ...vazia(), estado: 'coluna-mudou', trocadas };
      return { ...(await this.dados(cfg)), colunaId };
    } catch (e: unknown) {
      return { ...vazia(), estado: 'falhou', erro: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * A trava. Lê a linha de cabeçalho inteira e confere, letra a letra, se o
   * título continua o que foi medido.
   *
   * Divergência aqui não é aviso, é parada: importar com a coluna trocada grava
   * o dado no campo errado sem que nada reclame.
   */
  private async conferirCabecalho(cfg: CargaConfig): Promise<{ trocadas: ColunaTrocada[]; colunaId: string | null }> {
    const l = cfg.GOOGLE_SHEETS_CARGA_LINHA_CABECALHO;
    const [linha = []] = await this.sheets.batchGetValues(
      cfg.GOOGLE_SHEETS_SPREADSHEET_ID,
      [a1(cfg.GOOGLE_SHEETS_CARGA_TAB, `${l}:${l}`)],
      'FORMATTED_VALUE',
    );
    const titulos = linha[0] ?? [];

    const trocadas: ColunaTrocada[] = [];
    for (const campo of CAMPOS) {
      const { letra, titulo } = COLUNAS_CARGA[campo];
      if (!titulo) continue;
      const achado = normalizar(titulos[colToIndex(letra)]);
      if (achado !== normalizar(titulo)) {
        trocadas.push({ coluna: letra, esperado: titulo, encontrado: achado || '(vazio)' });
      }
    }

    /*
     * A coluna do identificador é procurada pelo TÍTULO, não fixada por letra:
     * ela mora longe do bloco do cadastro e não faz parte do mapa do José, e
     * fixá-la seria travar num ponto da aba que ninguém combinou.
     */
    const iId = titulos.findIndex((t) => normalizar(t) === TITULO_COLUNA_ID);
    return { trocadas, colunaId: iId >= 0 ? indexToCol(iId) : null };
  }

  /**
   * Lê uma faixa POR COLUNA, não um retângulo.
   *
   * De `C` a `HX` são 226 colunas × 9.920 linhas de dado que ninguém usa. São
   * onze faixas estreitas, e o alinhamento continua válido porque todas
   * começam na mesma linha: a n-ésima linha de cada faixa é a mesma linha da
   * planilha.
   */
  private async dados(cfg: CargaConfig): Promise<LeituraCarga> {
    const inicio = cfg.GOOGLE_SHEETS_CARGA_LINHA_INICIAL;
    const fim = cfg.GOOGLE_SHEETS_CARGA_LINHA_FINAL;
    const ranges = CAMPOS.map((c) => {
      const { letra } = COLUNAS_CARGA[c];
      return a1(cfg.GOOGLE_SHEETS_CARGA_TAB, `${letra}${inicio}:${letra}${fim}`);
    });
    const blocos = await this.sheets.batchGetValues(cfg.GOOGLE_SHEETS_SPREADSHEET_ID, ranges, 'FORMATTED_VALUE');

    const porCampo = new Map<Campo, string[][]>();
    CAMPOS.forEach((campo, i) => porCampo.set(campo, blocos[i] ?? []));
    const valor = (campo: Campo, i: number): string => texto((porCampo.get(campo) ?? [])[i]?.[0]);
    const altura = Math.max(0, ...CAMPOS.map((c) => (porCampo.get(c) ?? []).length));

    const linhas: LinhaCarga[] = [];
    let descartadas = 0;
    for (let i = 0; i < altura; i += 1) {
      const nome = valor('nome', i);
      /*
       * Sem nome não é produto. Abaixo do último produto a aba tem ~2.550
       * linhas em que só as fórmulas respondem (`NÃO`, `0,00`, a data de hoje);
       * contá-las como linha lida faria o relatório mentir o tamanho da carga.
       */
      if (!nome) { descartadas += 1; continue; }
      linhas.push({
        linha: inicio + i,
        situacao: valor('situacao', i),
        nome,
        codigoBarras: valor('codigoBarras', i),
        unidade: valor('unidade', i),
        grupo: valor('grupo', i),
        codigo: valor('codigo', i),
        estoqueMin: valor('estoqueMin', i),
        estoqueMax: valor('estoqueMax', i),
        custo: valor('custo', i),
        precoVenda: valor('precoVenda', i),
        grupoId: valor('grupoId', i),
      });
    }

    return {
      estado: 'ok',
      linhas,
      // quem sabe a coluna do identificador é `conferirCabecalho`; ela preenche
      colunaId: null,
      descartadas,
      trocadas: [],
      truncada: altura >= fim - inicio + 1,
    };
  }
}
