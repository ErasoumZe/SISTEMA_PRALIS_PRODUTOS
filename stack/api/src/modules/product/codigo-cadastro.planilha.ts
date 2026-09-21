import { inject, injectable } from 'tsyringe';
import { env } from '@/config/env';
import { SHEETS_GATEWAY } from '@/modules/google-sheets/google-sheets.di';
import { a1, indexToCol, type SheetsGateway } from '@/modules/google-sheets/google-sheets.client';
import { codigoCadastroValido } from './codigo-cadastro.motor';
import type { LinhaMixCompleta } from './importar-mix.motor';

/**
 * Leitura da aba MIX.
 *
 * **SÓ LEITURA**, e isso é regra, não detalhe: a planilha é a fonte da
 * numeração da rede. Se o sistema escrevesse nela, passaria a conferir o
 * próprio palpite contra ele mesmo. Quem escreve é a planilha oficial, pela
 * coluna AC, no caminho que já existia.
 *
 * Serve a dois usos: o **teto** da numeração (para a cunhagem) e a **lista de
 * produtos** a importar para a Base.
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
  linhas: LinhaMixCompleta[];
  /** Maior código de cadastro visto. É daqui que sai o próximo a cunhar. */
  teto: number;
  /** Linhas puladas por não terem código válido — legendas, totais, vazias. */
  descartadas: number;
  /** Títulos que o cabeçalho não tinha, quando o estado é `sem-coluna`. */
  faltando: string[];
  /**
   * A leitura chegou ao fim da janela configurada — pode haver produto além
   * dela. Teto defasado faz a cunhagem colidir com código que já existe.
   */
  truncada: boolean;
  erro?: string;
}

/**
 * Cada campo e o título da coluna de onde ele sai.
 *
 * Buscados pelo TÍTULO, não por posição: a aba tem 248 colunas e ganha colunas
 * novas com frequência; travar em "Z" faria a leitura passar a ler outra coisa
 * em silêncio no dia em que alguém inserisse uma coluna.
 *
 * `obrigatoria` é o que, faltando, invalida a leitura inteira. O resto some
 * do cadastro sem derrubar a importação.
 */
const COLUNAS = {
  codigo: { titulo: 'COD INTERNO', obrigatoria: true },
  nome: { titulo: 'DESCRIÇÃO', obrigatoria: true },
  codigoBarras: { titulo: 'COD BARRA 1', obrigatoria: true },
  ativo: { titulo: 'ATIVO', obrigatoria: false },
  ippt: { titulo: 'IPPT', obrigatoria: false },
  grupo: { titulo: 'MERCADORIAS', obrigatoria: false },
  marca: { titulo: 'MARCAS', obrigatoria: false },
  embalagem: { titulo: 'EMB', obrigatoria: false },
  quantidadeEmbalagem: { titulo: 'QUANT', obrigatoria: false },
  unidade: { titulo: 'UNID/KG', obrigatoria: false },
  setor: { titulo: 'SETOR', obrigatoria: false },
  estoqueMin: { titulo: 'MIN', obrigatoria: false },
  estoqueMax: { titulo: 'MAX', obrigatoria: false },
} as const;

type Campo = keyof typeof COLUNAS;
const CAMPOS = Object.keys(COLUNAS) as Campo[];

const normalizarTitulo = (valor: unknown): string => String(valor ?? '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toUpperCase()
  .replace(/\s+/g, ' ')
  .trim();

const vazio = (): LeituraMix => ({
  estado: 'ok', linhas: [], teto: 0, descartadas: 0, faltando: [], truncada: false,
});

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

  private async cabecalho(cfg: MixConfig): Promise<Partial<Record<Campo, number>> | { faltando: string[] }> {
    const linha = cfg.GOOGLE_SHEETS_MIX_LINHA_CABECALHO;
    const range = a1(cfg.GOOGLE_SHEETS_MIX_TAB, `${linha}:${linha}`);
    const [valores = []] = await this.sheets.batchGetValues(cfg.GOOGLE_SHEETS_MIX_SPREADSHEET_ID, [range], 'FORMATTED_VALUE');
    const titulos = (valores[0] ?? []).map(normalizarTitulo);

    /*
     * Comparação EXATA e primeira ocorrência. A aba tem `DESCRIÇÃO COMPLETA`,
     * `DESCRIÇÃO PLACAS` e `DESCRIÇÃO EXTRAIR` ao lado de `DESCRIÇÃO`, e
     * `COD CESTA`/`COD INT` ao lado de `COD INTERNO` — busca por prefixo pegaria
     * a coluna errada. `MIN`/`MAX` e `MARCAS` aparecem de novo nos blocos de
     * loja, mais à direita; a primeira ocorrência é a do cadastro.
     */
    const achado: Partial<Record<Campo, number>> = {};
    const faltando: string[] = [];
    for (const campo of CAMPOS) {
      const i = titulos.indexOf(normalizarTitulo(COLUNAS[campo].titulo));
      if (i >= 0) achado[campo] = i;
      else if (COLUNAS[campo].obrigatoria) faltando.push(COLUNAS[campo].titulo);
    }
    return faltando.length ? { faltando } : achado;
  }

  /**
   * Lê uma faixa POR COLUNA, não um retângulo.
   *
   * O retângulo entre a primeira e a última coluna úteis teria ~160 colunas ×
   * 6.000 linhas. Pedindo coluna a coluna são 13 faixas estreitas — o alinhamento
   * continua válido porque todas começam na mesma linha, e a n-ésima linha de
   * cada faixa é a mesma linha da planilha.
   */
  private async dados(cfg: MixConfig, cols: Partial<Record<Campo, number>>): Promise<LeituraMix> {
    const presentes = CAMPOS.filter((c) => cols[c] !== undefined);
    const ranges = presentes.map((c) => a1(
      cfg.GOOGLE_SHEETS_MIX_TAB,
      `${indexToCol(cols[c]!)}${cfg.GOOGLE_SHEETS_MIX_LINHA_INICIAL}:${indexToCol(cols[c]!)}${cfg.GOOGLE_SHEETS_MIX_LINHA_FINAL}`,
    ));
    const blocos = await this.sheets.batchGetValues(cfg.GOOGLE_SHEETS_MIX_SPREADSHEET_ID, ranges, 'FORMATTED_VALUE');

    const porCampo = new Map<Campo, string[][]>();
    presentes.forEach((campo, i) => porCampo.set(campo, blocos[i] ?? []));

    const alturaMaxima = cfg.GOOGLE_SHEETS_MIX_LINHA_FINAL - cfg.GOOGLE_SHEETS_MIX_LINHA_INICIAL + 1;
    const altura = Math.max(0, ...presentes.map((c) => (porCampo.get(c) ?? []).length));

    const valor = (campo: Campo, i: number): string => String((porCampo.get(campo) ?? [])[i]?.[0] ?? '').trim();

    const linhas: LinhaMixCompleta[] = [];
    let descartadas = 0;
    let teto = 0;
    for (let i = 0; i < altura; i += 1) {
      const codigo = valor('codigo', i).replace(/\D/g, '');
      /*
       * Fora da faixa do PDV não é código: é código de barras digitado na coluna
       * errada — o erro de campo que o PR #62 documentou. Deixar passar faria o
       * teto virar a casa dos trilhões e a cunhagem seguinte sair de lá.
       */
      if (!codigoCadastroValido(codigo)) { descartadas += 1; continue; }
      const nome = valor('nome', i);
      /*
       * O teto conta só linha COM PRODUTO.
       *
       * A aba tem a numeração pré-preenchida por fórmula bem além do que já foi
       * cadastrado: medido em 20/09, 313 linhas de 13127 a 13439 com código e
       * **nenhum nome**. Contá-las empurrava o teto para 13439 e a cunhagem
       * seguinte sairia em 13440, pulando 313 números que estão livres.
       *
       * A linha vazia continua entrando em `linhas` — quem importa já a recusa
       * por não ter nome, e o número dela ainda serve para o relatório.
       */
      const numero = Number(codigo);
      if (nome && numero > teto) teto = numero;
      linhas.push({
        linha: cfg.GOOGLE_SHEETS_MIX_LINHA_INICIAL + i,
        codigo,
        nome,
        codigoBarras: valor('codigoBarras', i) || null,
        ativo: valor('ativo', i),
        ippt: valor('ippt', i),
        grupo: valor('grupo', i),
        marca: valor('marca', i),
        embalagem: valor('embalagem', i),
        quantidadeEmbalagem: valor('quantidadeEmbalagem', i),
        unidade: valor('unidade', i),
        setor: valor('setor', i),
        estoqueMin: valor('estoqueMin', i),
        estoqueMax: valor('estoqueMax', i),
        /*
         * `custo` fica VAZIO de propósito. A aba tem `V. CUSTO` dentro do bloco
         * da TNP e `V. CUSTO LI` no da LI, e o produto da Base vale para a rede
         * — escolher um dos dois seria escolher por você. E custo errado não
         * fica só errado: ele calcula o preço de venda.
         */
        custo: '',
      });
    }

    return {
      estado: 'ok',
      linhas,
      teto,
      descartadas,
      faltando: [],
      // a janela acabou cheia: pode haver produto além dela
      truncada: altura >= alturaMaxima,
    };
  }
}
