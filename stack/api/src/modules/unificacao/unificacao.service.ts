import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { ProductEnums } from '@pralis/shared';
import { db } from '@/db/databases';
import { env } from '@/config/env';
import { AppError } from '@/config/api.replies';
import { ProductRepository } from '@/modules/product/product.repository';
import { unifFonteProduto } from './unificacao.table';
import { vendaProdutoDia } from '@/modules/vendas/vendas.table';
import { GoogleSheetsClient, a1, indexToCol } from '@/modules/google-sheets/google-sheets.client';
import {
  ARQUIVOS,
  barrasAmbiguas,
  chaveDeBarras,
  lerFonte,
  normalizarNome,
  type Fonte,
  type FonteArquivo,
  type LinhaFonte,
} from './unificacao.fontes';

export interface ResumoFonte {
  fonte: Fonte;
  linhas: number;
  comBarras: number;
  semBarras: number;
  ativos: number;
  inativos: number;
  semStatus: number;
  /** Quantos vêm com grupo de mercadoria. Só o SIA e o Pralis têm. */
  comGrupo: number;
  /** Grupos distintos que a fonte trouxe, com quantos produtos cada um. */
  grupos: Array<{ grupo: string; produtos: number }>;
  /** Códigos de barras que cobrem produtos diferentes DENTRO da mesma fonte. */
  barrasConflitantes: Array<{ chave: string; nomes: string[] }>;
}

export interface UnificacaoHealth {
  carregado: boolean;
  carregadoEm: string | null;
  total: number;
  fontes: ResumoFonte[];
}

const LOTE = 500;

@injectable()
export class UnificacaoService {
  constructor(@inject(ProductRepository) private products: ProductRepository) {}

  /** Pasta das fontes. Configurável para o container achar os CSVs no deploy. */
  private pastaFontes(): string {
    return env.UNIFICACAO_FONTES_DIR || resolve(process.cwd(), '../../docs');
  }

  /**
   * A base viva do Pralis entra no staging como mais uma fonte, para a tela
   * conseguir dizer "isto já existe" sem consultar dois lugares.
   *
   * Reusa o `list` do repositório uma vez por catálogo — mesmo caminho já
   * testado da listagem, e herda a regra de que cadastro aposentado por
   * unificação não é mais um produto.
   */
  private async lerPralis(): Promise<LinhaFonte[]> {
    const porLoja = await Promise.all(
      ProductEnums.catalogo.options.map((loja) => this.products.list(loja, {})),
    );
    return porLoja.flat().map((p) => ({
      fonte: 'pralis' as const,
      codInterno: p.codigoInterno ?? '',
      codBarras: p.codigoBarras ?? '',
      chaveBarras: chaveDeBarras(p.codigoBarras),
      nome: p.nome,
      nomeNormalizado: normalizarNome(p.nome),
      ativo: p.status === 'ativo',
      grupo: p.grupo,
      custo: p.custo,
      venda: p.vVendaPontual,
      ncm: p.fiscal?.ncm ?? null,
      cst: p.fiscal?.cstPisCofins ?? null,
      csosn: null,
      aliqEcf: null,
      reducao: p.fiscal?.reducaoIcms ?? null,
      aliqInterna: p.fiscal?.icms ?? null,
      icmsEfetivo: null,
      raw: { id: p.id, loja: p.loja, codigo: p.codigo, grupo: p.grupo ?? '' },
    }));
  }

  /**
   * Universo da Central: uma linha por produto que passou pelo PDV nos últimos
   * 12 meses. A identidade do ERP sobrevive a renomeações; quando o histórico
   * antigo ainda não tem esse ID, cai no par código + nome, exatamente como o
   * relatório de produtos únicos.
   *
   * O nome e o código exibidos são os da venda mais recente. Quantidade e valor
   * ficam no `raw` apenas para auditoria: não viram custo nem preço de cadastro.
   */
  private async lerVendasDosUltimos12Meses(): Promise<LinhaFonte[]> {
    const resultado = await db.execute(sql`
      SELECT loja,
             COALESCE(NULLIF(produto_id_erp, ''), produto_codigo || '|' || produto) AS identidade,
             (array_agg(produto_id_erp ORDER BY data DESC))[1] AS produto_id_erp,
             (array_agg(produto_codigo ORDER BY data DESC))[1] AS produto_codigo,
             (array_agg(produto ORDER BY data DESC))[1] AS produto,
             MIN(data)::text AS primeira_venda,
             MAX(data)::text AS ultima_venda,
             COUNT(DISTINCT produto)::int AS nomes_diferentes,
             SUM(quantidade) AS quantidade,
             SUM(total) AS faturamento
        FROM ${vendaProdutoDia}
       WHERE data >= (CURRENT_DATE - INTERVAL '12 months')::date
         AND data <= CURRENT_DATE
       GROUP BY loja, COALESCE(NULLIF(produto_id_erp, ''), produto_codigo || '|' || produto)
    `);

    return resultado.rows.map((row) => {
      const codigo = String(row.produto_codigo ?? '');
      const nome = String(row.produto ?? '');
      const idErp = String(row.produto_id_erp ?? '');
      return {
        fonte: 'vendas_pdv_12m' as const,
        codInterno: idErp,
        codBarras: codigo,
        chaveBarras: chaveDeBarras(codigo),
        nome,
        nomeNormalizado: normalizarNome(nome),
        ativo: true,
        grupo: null,
        custo: null,
        venda: null,
        ncm: null,
        cst: null,
        csosn: null,
        aliqEcf: null,
        reducao: null,
        aliqInterna: null,
        icmsEfetivo: null,
        raw: {
          loja: String(row.loja ?? ''),
          produtoIdErp: idErp,
          identidade: String(row.identidade ?? ''),
          primeiraVenda: String(row.primeira_venda ?? ''),
          ultimaVenda: String(row.ultima_venda ?? ''),
          nomesDiferentes: String(row.nomes_diferentes ?? '0'),
          quantidade: String(row.quantidade ?? '0'),
          faturamento: String(row.faturamento ?? '0'),
          periodo: 'ultimos_12_meses',
        },
      };
    });
  }

  private lerArquivo(fonte: FonteArquivo): LinhaFonte[] {
    const caminho = resolve(this.pastaFontes(), ARQUIVOS[fonte]);
    try {
      return lerFonte(fonte, readFileSync(caminho, 'utf8'));
    } catch {
      throw new AppError(
        `Arquivo da fonte "${fonte}" não encontrado em ${caminho}.`,
        503,
        'UNIFICACAO_FONTE_AUSENTE',
      );
    }
  }

  /** Cabeçalho comparável da planilha, tolerando acento, ponto e espaço. */
  private normalizarCabecalho(valor: unknown): string {
    return String(valor ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9%]+/g, ' ')
      .trim();
  }

  /**
   * Lê a planilha oficial no momento da carga. O CSV versionado continua sendo
   * fallback de desenvolvimento/teste, mas nunca é tratado como a planilha viva
   * quando a integração está habilitada.
   */
  private async lerPlanilhaNovaOnline(): Promise<LinhaFonte[]> {
    const sheets = new GoogleSheetsClient();
    const abas = await sheets.getSheets(env.GOOGLE_SHEETS_SPREADSHEET_ID);
    const aba = abas.find((item) => item.title === env.GOOGLE_SHEETS_BASE_TAB);
    if (!aba) {
      throw new AppError(
        `Aba "${env.GOOGLE_SHEETS_BASE_TAB}" não encontrada na planilha nova.`,
        503,
        'UNIFICACAO_PLANILHA_ABA_AUSENTE',
      );
    }

    const ultimaColuna = indexToCol(Math.max(0, aba.columnCount - 1));
    const [cabecalhoRange, dadosRange] = await sheets.batchGetValues(
      env.GOOGLE_SHEETS_SPREADSHEET_ID,
      [
        a1(aba.title, `A5:${ultimaColuna}5`),
        a1(aba.title, `A11:${ultimaColuna}${aba.rowCount}`),
      ],
      'FORMATTED_VALUE',
    );
    const cabecalhos = cabecalhoRange?.[0] ?? [];
    const achar = (...nomes: string[]): number => {
      const alvos = nomes.map((nome) => this.normalizarCabecalho(nome));
      return cabecalhos.findIndex((cabecalho) => alvos.includes(this.normalizarCabecalho(cabecalho)));
    };

    const nomeI = achar('CADASTRO PRODUTOS ATUALIZADO NOVO', 'NOME');
    const barrasI = achar('CODIGO BARRAS', 'COD. BARRAS', 'EAN', 'GTIN');
    const internoI = achar('CODIGO INT', 'CODIGO INTERNO');
    const statusI = achar('V', 'A/I', 'ATIVO');
    const idI = achar('ID');
    if (nomeI < 0 || barrasI < 0) {
      throw new AppError(
        'A planilha nova não possui os cabeçalhos de nome e código de barras esperados.',
        503,
        'UNIFICACAO_PLANILHA_LAYOUT_INVALIDO',
      );
    }

    return (dadosRange ?? [])
      .map((linha, indice) => {
        const nome = String(linha[nomeI] ?? '').trim();
        const codBarras = String(linha[barrasI] ?? '').trim();
        const codInterno = internoI >= 0 ? String(linha[internoI] ?? '').trim() : '';
        return {
          fonte: 'planilha_nova' as const,
          codInterno,
          codBarras,
          chaveBarras: chaveDeBarras(codBarras),
          nome,
          nomeNormalizado: normalizarNome(nome),
          ativo: statusI >= 0 ? ['INATIVO', 'I', 'NAO', 'N'].includes(
            this.normalizarCabecalho(linha[statusI]),
          ) ? false : true : null,
          grupo: null,
          custo: null,
          venda: null,
          ncm: null,
          cst: null,
          csosn: null,
          aliqEcf: null,
          reducao: null,
          aliqInterna: null,
          icmsEfetivo: null,
          raw: {
            linha: String(11 + indice),
            id: idI >= 0 ? String(linha[idI] ?? '') : '',
            nome,
            codBarras,
            codInterno,
          },
        } satisfies LinhaFonte;
      })
      .filter((linha) => linha.nome !== '' || linha.codBarras !== '' || linha.codInterno !== '');
  }

  /**
   * Apaga e recarrega TUDO. Rodar de novo dá o mesmo estado — é retrato, não
   * histórico. Nada aqui encosta na tabela `products`.
   */
  async carregar(): Promise<UnificacaoHealth> {
    const fontesDeArquivo = (Object.keys(ARQUIVOS) as FonteArquivo[])
      // `vendidos_tnp` era um recorte estático e sem janela temporal. Foi
      // substituído pelas vendas reais do banco nos últimos 12 meses.
      .filter((fonte) => fonte !== 'planilha_nova' && fonte !== 'vendidos_tnp');
    const doArquivo = fontesDeArquivo.flatMap((fonte) => this.lerArquivo(fonte));
    const planilhaNova = env.GOOGLE_SHEETS_ENABLED && env.NODE_ENV !== 'test'
      ? await this.lerPlanilhaNovaOnline()
      : this.lerArquivo('planilha_nova');
    const [doPralis, dosPdvs] = await Promise.all([
      this.lerPralis(),
      this.lerVendasDosUltimos12Meses(),
    ]);
    const todas = [...doArquivo, ...planilhaNova, ...doPralis, ...dosPdvs];

    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM unif_fonte_produto`);
      for (let i = 0; i < todas.length; i += LOTE) {
        await tx.insert(unifFonteProduto).values(
          todas.slice(i, i + LOTE).map((l) => ({
            fonte: l.fonte,
            codInterno: l.codInterno,
            codBarras: l.codBarras,
            chaveBarras: l.chaveBarras,
            nome: l.nome,
            nomeNormalizado: l.nomeNormalizado,
            ativo: l.ativo,
            grupo: l.grupo,
            custo: l.custo == null ? null : String(l.custo),
            venda: l.venda == null ? null : String(l.venda),
            ncm: l.ncm,
            cst: l.cst,
            csosn: l.csosn,
            aliqEcf: l.aliqEcf,
            reducao: l.reducao == null ? null : String(l.reducao),
            aliqInterna: l.aliqInterna == null ? null : String(l.aliqInterna),
            icmsEfetivo: l.icmsEfetivo == null ? null : String(l.icmsEfetivo),
            raw: l.raw,
          })),
        );
      }
    });

    return this.health();
  }

  async health(): Promise<UnificacaoHealth> {
    const linhas = await db
      .select({
        fonte: unifFonteProduto.fonte,
        chaveBarras: unifFonteProduto.chaveBarras,
        nome: unifFonteProduto.nome,
        ativo: unifFonteProduto.ativo,
        grupo: unifFonteProduto.grupo,
        carregadoEm: unifFonteProduto.carregadoEm,
      })
      .from(unifFonteProduto);

    const porFonte = new Map<Fonte, typeof linhas>();
    for (const l of linhas) {
      const f = l.fonte as Fonte;
      porFonte.set(f, [...(porFonte.get(f) ?? []), l]);
    }

    const contarGrupos = (ls: typeof linhas) => {
      const m = new Map<string, number>();
      for (const l of ls) if (l.grupo) m.set(l.grupo, (m.get(l.grupo) ?? 0) + 1);
      return [...m.entries()]
        .map(([grupo, produtos]) => ({ grupo, produtos }))
        .sort((a, b) => b.produtos - a.produtos);
    };

    const fontes: ResumoFonte[] = [...porFonte.entries()].map(([fonte, ls]) => ({
      fonte,
      linhas: ls.length,
      comBarras: ls.filter((l) => l.chaveBarras !== '').length,
      semBarras: ls.filter((l) => l.chaveBarras === '').length,
      ativos: ls.filter((l) => l.ativo === true).length,
      inativos: ls.filter((l) => l.ativo === false).length,
      semStatus: ls.filter((l) => l.ativo == null).length,
      comGrupo: ls.filter((l) => !!l.grupo).length,
      grupos: contarGrupos(ls),
      barrasConflitantes: barrasAmbiguas(
        ls.map((l) => ({ chaveBarras: l.chaveBarras, nome: l.nome }) as LinhaFonte),
      ),
    })).sort((a, b) => a.fonte.localeCompare(b.fonte));

    return {
      carregado: linhas.length > 0,
      carregadoEm: linhas[0]?.carregadoEm?.toISOString() ?? null,
      total: linhas.length,
      fontes,
    };
  }
}
