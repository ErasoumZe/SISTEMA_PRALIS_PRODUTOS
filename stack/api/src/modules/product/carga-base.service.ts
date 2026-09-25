import { inject, injectable } from 'tsyringe';
import { eq, sql } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { db } from '@/db/databases';
import { env } from '@/config/env';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { SHEETS_GATEWAY } from '@/modules/google-sheets/google-sheets.di';
import { a1, type SheetsGateway } from '@/modules/google-sheets/google-sheets.client';
import { productSheetSync } from '@/modules/google-sheets/product-sheet-sync.table';
import { products, productFiscal } from './product.table';
import { CargaBasePlanilhaService, type EstadoCarga, type ColunaTrocada } from './carga-base.planilha';
import {
  FISCAL_ZERADO, colunaDeIdentificadores, parearLinhasComProdutos, planejarCarga,
  type DecisaoCarga, type MotivoRecusa, type ProdutoDaCarga, type ResumoCarga, type Vinculo,
} from './carga-base.motor';

/**
 * CARGA DA BASE — põe no sistema todos os produtos da planilha.
 *
 * Três decisões moldam este serviço, e as três são do José em 25/09/2026:
 *
 * 1. **Todos os produtos, iguais à planilha.** Nada de amostra, nada de lote
 *    que deixa resto. Ativo entra ativo, inativo entra inativo.
 * 2. **A Base é zerada antes.** É uma carga, não uma fusão: o que está lá sai,
 *    e entra o que a planilha diz. Só a loja `BASE` é apagada; o cadastro
 *    próprio de TNP e LI não é tocado.
 * 3. **O fiscal entra zerado**, com a largura que o TXT do Creare exige.
 *
 * ### O espelho fica DESLIGADO aqui, e isso não é detalhe
 *
 * Todo cadastro normal chama `ProductSheetService.registerPending`, que
 * enfileira a linha para ser escrita de volta na planilha. Só que
 * `GOOGLE_SHEETS_BASE_TAB` é **a mesma aba que esta carga lê**. Espelhar aqui
 * devolveria 7.369 linhas para dentro da fonte, duplicando a planilha inteira
 * na primeira execução. Então a carga grava só no banco. Quem veio da planilha
 * não precisa voltar para ela.
 *
 * ### Uma transação só
 *
 * Os 7.369 produtos entram num `INSERT` em blocos dentro de UMA transação. Ou
 * a Base inteira fica de pé, ou nada muda — que é o que "não pode haver erros"
 * exige. Produto a produto, uma falha na linha 6.000 deixaria meia Base no ar,
 * sem ninguém saber onde parou.
 */

/** Mesmo alfabeto e formato da Central: sem caracteres que se confundem lendo. */
const rand4 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);

export const CONFIRMACAO_CARGA = 'ZERAR A BASE E IMPORTAR A PLANILHA';

/** Quantas linhas por `INSERT`. Postgres tem teto de parâmetros por comando. */
const BLOCO = 500;

export interface PreviaCarga {
  estado: EstadoCarga;
  erro?: string;
  /** Colunas cujo título saiu do lugar. Havendo uma, a carga não roda. */
  trocadas: ColunaTrocada[];
  truncada: boolean;
  linhasLidas: number;
  linhasSemNome: number;
  importar: number;
  ativos: number;
  inativos: number;
  comBarras: number;
  recusas: Record<MotivoRecusa, number>;
  /** As recusadas, todas: com zero recusa a lista vem vazia e a tela diz isso. */
  recusadas: DecisaoCarga[];
  barrasRepetidas: ResumoCarga['barrasRepetidas'];
  porGrupo: ResumoCarga['porGrupo'];
  /** Quantos produtos da Base seriam apagados antes de entrar os novos. */
  apagar: number;
  /**
   * Quantos produtos da Base já sabem em que linha da planilha moram.
   *
   * Produto sem isso faz a loja abrir LINHA NOVA ao importar, em vez de
   * preencher a linha que ele já ocupa. Por isso o número fica à vista.
   */
  vinculados: number;
  confirmacaoVinculo: string;
  /** Amostra do que entraria, para conferir campo a campo antes de mandar. */
  amostra: ProdutoDaCarga[];
  confirmacao: string;
}

export interface ResultadoCarga {
  apagados: number;
  criados: number;
  ativos: number;
  inativos: number;
  /** Linhas da planilha que receberam o identificador do produto. */
  vinculadas: number;
}

export interface ResultadoVinculo {
  /** Linhas que passaram a apontar para o produto. */
  vinculadas: number;
  /** Já apontavam antes; nenhuma foi sobrescrita. */
  jaVinculadas: number;
  linhasSemProduto: number;
  produtosSemLinha: number;
  codigosRepetidos: Array<{ codigo: string; linhas: number[] }>;
}

export const CONFIRMACAO_VINCULO = 'VINCULAR AS LINHAS DA PLANILHA';

@injectable()
export class CargaBaseService {
  constructor(
    @inject(CargaBasePlanilhaService) private planilha: CargaBasePlanilhaService,
    @inject(SHEETS_GATEWAY) private sheets: SheetsGateway,
  ) {}

  /**
   * Carimba, nas linhas que JÁ EXISTEM, o identificador do produto da Base.
   *
   * Por que isto precisa existir: a carga enche a Base lendo a planilha e sem
   * escrever nada nela. Só que o resto do sistema descobre em que linha mora um
   * produto procurando o identificador dele na coluna `ID`. Com a coluna vazia,
   * nenhuma das 7.369 linhas era reconhecida — e importar um produto da Base
   * para a loja abria LINHA NOVA no fim em vez de preencher o bloco da loja na
   * linha que o produto já ocupava. Medido em produção em 25/09/2026: o código
   * 7 passou a existir nas linhas 11 e 7380.
   *
   * O que isto NÃO faz: não cria linha, não mexe em nenhuma outra coluna e
   * nunca apaga identificador que já esteja lá. É uma coluna, uma escrita.
   */
  async vincular(confirmacao: string): Promise<ResultadoVinculo> {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_VINCULO) {
      throw new AppError(`Frase de confirmação inválida. Digite "${CONFIRMACAO_VINCULO}" para vincular.`, 400);
    }
    const leitura = await this.planilha.ler();
    if (leitura.estado === 'coluna-mudou') {
      const quais = leitura.trocadas.map((t) => `${t.coluna} (esperava "${t.esperado}", achou "${t.encontrado}")`).join('; ');
      throw new AppError(`A planilha mudou de forma e nada foi escrito. Confira: ${quais}`, 409);
    }
    if (leitura.estado !== 'ok') {
      throw new AppError('A planilha não pôde ser lida agora; nada foi escrito.', 503);
    }
    if (!leitura.colunaId) {
      throw new AppError(
        `A aba não tem coluna "ID". Sem ela não há onde carimbar, e a loja continuaria criando linha nova a cada importação.`,
        409,
      );
    }

    const produtos = await db
      .select({ id: products.id, codigoInterno: products.codigoInterno })
      .from(products)
      .where(eq(products.loja, 'BASE'));

    const pareamento = parearLinhasComProdutos(leitura.linhas, produtos);

    const aba = env.GOOGLE_SHEETS_CARGA_TAB;
    const primeira = env.GOOGLE_SHEETS_CARGA_LINHA_INICIAL;
    const coluna = leitura.colunaId;
    const [atuais = []] = await this.sheets.batchGetValues(
      env.GOOGLE_SHEETS_SPREADSHEET_ID,
      [a1(aba, `${coluna}${primeira}:${coluna}${env.GOOGLE_SHEETS_CARGA_LINHA_FINAL}`)],
      'FORMATTED_VALUE',
    );
    const jaLa = atuais.map((r) => String(r?.[0] ?? '').trim());
    const jaVinculadas = jaLa.filter((v) => v !== '').length;

    const { valores, de, ate, escritas } = colunaDeIdentificadores(pareamento.vinculos, jaLa, primeira);
    if (valores.length) {
      /*
       * RAW de propósito: o identificador é um UUID, e `USER_ENTERED` deixaria
       * a planilha tentar interpretá-lo — já houve caso de texto virar data.
       */
      await this.sheets.batchUpdateValues(
        env.GOOGLE_SHEETS_SPREADSHEET_ID,
        [{ range: a1(aba, `${coluna}${de}:${coluna}${ate}`), values: valores }],
        'RAW',
      );
    }

    await this.registrarEspelho(pareamento.vinculos, aba);

    return {
      vinculadas: escritas,
      jaVinculadas,
      linhasSemProduto: pareamento.linhasSemProduto.length,
      produtosSemLinha: pareamento.produtosSemLinha.length,
      codigosRepetidos: pareamento.codigosRepetidos,
    };
  }

  /**
   * Diz ao controle de espelhamento que cada produto já tem linha.
   *
   * Sem isto, a fila de reenvio continuaria tratando os 7.369 como pendentes e
   * tentaria escrevê-los de novo — que é justamente o que a carga evita.
   */
  private async registrarEspelho(vinculos: readonly Vinculo[], aba: string): Promise<void> {
    if (vinculos.length === 0) return;
    const linhas = vinculos.map((v) => ({
      productId: v.produtoId,
      spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
      sheetName: aba,
      rowNumber: v.linha,
      status: 'synced',
      syncedAt: new Date(),
    }));
    for (let i = 0; i < linhas.length; i += BLOCO) {
      await db.insert(productSheetSync).values(linhas.slice(i, i + BLOCO)).onConflictDoUpdate({
        target: productSheetSync.productId,
        set: {
          spreadsheetId: sql`excluded.spreadsheet_id`,
          sheetName: sql`excluded.sheet_name`,
          rowNumber: sql`excluded.row_number`,
          status: sql`excluded.status`,
          syncedAt: sql`excluded.synced_at`,
          updatedAt: sql`now()`,
        },
      });
    }
  }

  private async planejar() {
    const leitura = await this.planilha.ler();
    if (leitura.estado !== 'ok') return { leitura, plano: null };
    return { leitura, plano: planejarCarga(leitura.linhas) };
  }

  /** Produtos da Base que já têm linha conhecida na planilha. */
  private async quantosVinculados(): Promise<number> {
    const r = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(productSheetSync)
      .innerJoin(products, eq(products.id, productSheetSync.productId))
      .where(sql`${products.loja} = 'BASE' AND ${productSheetSync.rowNumber} IS NOT NULL`);
    return Number(r[0]?.n ?? 0);
  }

  private async quantosNaBase(): Promise<number> {
    const r = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.loja, 'BASE'));
    return Number(r[0]?.n ?? 0);
  }

  async previa(): Promise<PreviaCarga> {
    const { leitura, plano } = await this.planejar();
    const semRecusa: Record<MotivoRecusa, number> = {
      'codigo-invalido': 0, 'codigo-repetido-na-planilha': 0, 'sem-nome': 0,
      'situacao-desconhecida': 0, 'unidade-desconhecida': 0, 'sem-id-de-grupo': 0,
    };
    return {
      estado: leitura.estado,
      erro: leitura.erro,
      trocadas: leitura.trocadas,
      truncada: leitura.truncada,
      linhasLidas: leitura.linhas.length,
      linhasSemNome: leitura.descartadas,
      importar: plano?.importar ?? 0,
      ativos: plano?.ativos ?? 0,
      inativos: plano?.inativos ?? 0,
      comBarras: plano?.comBarras ?? 0,
      recusas: plano?.recusas ?? semRecusa,
      recusadas: (plano?.decisoes ?? []).filter((d) => d.acao === 'recusar'),
      barrasRepetidas: plano?.barrasRepetidas ?? [],
      porGrupo: plano?.porGrupo ?? [],
      apagar: await this.quantosNaBase(),
      vinculados: await this.quantosVinculados(),
      confirmacaoVinculo: CONFIRMACAO_VINCULO,
      amostra: (plano?.decisoes ?? []).filter((d) => d.acao === 'importar').slice(0, 20).map((d) => d.produto!),
      confirmacao: CONFIRMACAO_CARGA,
    };
  }

  /**
   * Zera a Base e cria todos os produtos da planilha.
   *
   * A planilha é lida DE NOVO aqui, e não reaproveitada da prévia: entre ver a
   * prévia e confirmar podem passar minutos, e a planilha é editada ao vivo.
   * Importar o que a prévia mostrou seria importar o passado.
   */
  async importar(user: CurrentUser, confirmacao: string): Promise<ResultadoCarga> {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_CARGA) {
      throw new AppError(`Frase de confirmação inválida. Digite "${CONFIRMACAO_CARGA}" para carregar a Base.`, 400);
    }
    const { leitura, plano } = await this.planejar();
    if (leitura.estado === 'coluna-mudou') {
      const quais = leitura.trocadas.map((t) => `${t.coluna} (esperava "${t.esperado}", achou "${t.encontrado}")`).join('; ');
      throw new AppError(`A planilha mudou de forma e nada foi importado. Confira: ${quais}`, 409);
    }
    if (leitura.estado !== 'ok' || !plano) {
      throw new AppError('A planilha não pôde ser lida agora; nada foi alterado.', 503);
    }
    if (plano.importar === 0) {
      throw new AppError('A planilha não trouxe nenhum produto que possa entrar; nada foi alterado.', 409);
    }

    /*
     * Guarda a DECISÃO, não só o produto: é dela que sai a linha de origem na
     * planilha, e é essa linha que o carimbo precisa para não abrir linha nova.
     * A ordem de `returning` acompanha a ordem inserida, então o índice casa.
     */
    const aCriar = plano.decisoes.filter((d) => d.acao === 'importar');
    const novos = aCriar.map((d) => d.produto!);

    return db.transaction(async (tx) => {
      const apagados = await tx.delete(products).where(eq(products.loja, 'BASE')).returning({ id: products.id });

      const linhas = novos.map((p) => ({
        loja: 'BASE',
        codigo: `PR-${rand4()}-${rand4()}`,
        codigoInterno: p.codigoInterno,
        nome: p.nome,
        codigoBarras: p.codigoBarras,
        medidaBase: p.medidaBase,
        tipo: p.tipo,
        status: p.status,
        grupo: p.grupo,
        grupoId: p.grupoId,
        estoqueMin: p.estoqueMin === null ? null : String(p.estoqueMin),
        estoqueMax: p.estoqueMax === null ? null : String(p.estoqueMax),
        custo: p.custo === null ? null : String(p.custo),
        vVendaPontual: p.precoVenda === null ? null : String(p.precoVenda),
        createdByUserId: user.id,
        createdByName: user.name,
      }));

      const criados: string[] = [];
      for (let i = 0; i < linhas.length; i += BLOCO) {
        const parte = await tx.insert(products).values(linhas.slice(i, i + BLOCO)).returning({ id: products.id });
        for (const p of parte) criados.push(p.id);
      }

      /*
       * O fiscal zerado entra para TODOS, no mesmo passo. Produto sem linha
       * fiscal nenhuma é derrubado pelo gerador do Creare com "Dados fiscais
       * ausentes" — e aí a carga teria sido inútil para o que ela existe.
       */
      const fiscais = criados.map((productId) => ({
        productId,
        ncm: FISCAL_ZERADO.ncm,
        cest: FISCAL_ZERADO.cest,
        cstPisCofins: FISCAL_ZERADO.cstPisCofins,
        aliquotaEcfId: FISCAL_ZERADO.aliquotaEcfId,
        aliquotaCheia: String(FISCAL_ZERADO.aliquotaCheia),
        aliquotaFcp: String(FISCAL_ZERADO.aliquotaFcp),
        aliquotaPis: String(FISCAL_ZERADO.aliquotaPis),
        aliquotaCofins: String(FISCAL_ZERADO.aliquotaCofins),
        reducaoIcms: String(FISCAL_ZERADO.reducaoIcms),
        icms: String(FISCAL_ZERADO.icms),
        categoria: FISCAL_ZERADO.categoria,
        aliquotaEcf: FISCAL_ZERADO.aliquotaEcf,
        estado: FISCAL_ZERADO.estado,
        motivo: FISCAL_ZERADO.motivo,
      }));
      for (let i = 0; i < fiscais.length; i += BLOCO) {
        await tx.insert(productFiscal).values(fiscais.slice(i, i + BLOCO));
      }

      return {
        apagados: apagados.length,
        criados: criados.length,
        ativos: plano.ativos,
        inativos: plano.inativos,
        vinculados: criados.map((id, i) => ({ id, linha: aCriar[i]!.linha })),
      };
    }).then(async (r) => {
      /*
       * O carimbo vem DEPOIS da transação, e de propósito: ele fala com o
       * Google, e uma transação do Postgres aberta esperando rede é o jeito
       * mais rápido de segurar conexão do banco inteiro. Se o carimbo falhar, a
       * Base continua de pé e o botão "Vincular" refaz só esta parte.
       */
      let vinculadas = 0;
      try {
        vinculadas = await this.carimbar(r.vinculados);
      } catch { /* o resultado abaixo já diz que nada foi vinculado */ }
      return {
        apagados: r.apagados, criados: r.criados, ativos: r.ativos, inativos: r.inativos, vinculadas,
      };
    });
  }

  /** Escreve a coluna de identificadores para os pares (produto, linha) dados. */
  private async carimbar(pares: ReadonlyArray<{ id: string; linha: number }>): Promise<number> {
    if (pares.length === 0) return 0;
    const { colunaId } = await this.planilha.ler();
    if (!colunaId) return 0;
    const aba = env.GOOGLE_SHEETS_CARGA_TAB;
    const primeira = env.GOOGLE_SHEETS_CARGA_LINHA_INICIAL;
    const [atuais = []] = await this.sheets.batchGetValues(
      env.GOOGLE_SHEETS_SPREADSHEET_ID,
      [a1(aba, `${colunaId}${primeira}:${colunaId}${env.GOOGLE_SHEETS_CARGA_LINHA_FINAL}`)],
      'FORMATTED_VALUE',
    );
    const vinculos: Vinculo[] = pares.map((p) => ({ linha: p.linha, produtoId: p.id, codigo: '' }));
    const { valores, de, ate, escritas } = colunaDeIdentificadores(
      vinculos,
      atuais.map((r) => String(r?.[0] ?? '').trim()),
      primeira,
    );
    if (valores.length) {
      await this.sheets.batchUpdateValues(
        env.GOOGLE_SHEETS_SPREADSHEET_ID,
        [{ range: a1(aba, `${colunaId}${de}:${colunaId}${ate}`), values: valores }],
        'RAW',
      );
    }
    await this.registrarEspelho(vinculos, aba);
    return escritas;
  }
}
