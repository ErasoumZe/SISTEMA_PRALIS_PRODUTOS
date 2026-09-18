import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { ProductSheetService } from '@/modules/google-sheets/product-sheet.service';
import { siaProdutoDePara } from '@/modules/creare/creare.table';
import { products, productCodigoInternoHistory } from './product.table';
import { MAIOR_CODIGO_CADASTRO, type ParSia, type ProdutoParaReconciliar } from './codigo-cadastro.motor';

/** Uma troca já decidida, com o valor que a TELA mostrou. */
export interface TrocaPedida {
  productId: string;
  loja: string;
  /**
   * O código como estava na tela de quem decidiu — não relido no servidor.
   *
   * É o que transforma a guarda otimista em guarda de verdade: relendo aqui, a
   * janela protegida seria de milissegundos dentro do request, e a decisão de
   * quem clicou primeiro seria sobrescrita em silêncio por quem estava com a
   * tela velha aberta. Mesmo padrão do `totalEsperado` em `product-zerar`.
   */
  codigoAnteriorEsperado: string | null;
  codigoNovo: string;
  fonte: string;
  alteradoPorUserId: string;
  alteradoPorNome: string;
}

export type ResultadoTroca = 'trocado' | 'mudou-embaixo';

export interface CodigoCadastroRepo {
  listarProdutos(): Promise<ProdutoParaReconciliar[]>;
  /** O de-para do SIA de TODAS as lojas — a régua da numeração. */
  listarPares(): Promise<ParSia[]>;
  maiorCodigo(): Promise<number>;
  /** Maior `coditem` já visto no SIA: piso para não cunhar sobre a rede. */
  tetoSia(): Promise<number>;
  trocar(pedido: TrocaPedida): Promise<ResultadoTroca>;
  cunhar(pedido: Omit<TrocaPedida, 'codigoNovo'>, teto: number): Promise<{ resultado: ResultadoTroca; codigo: string }>;
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/**
 * Trava nomeada para a cunhagem.
 *
 * Sem ela, dois admins cunhando ao mesmo tempo leem o mesmo `MAX` e geram o
 * mesmo número — e a guarda por `codigo_anterior` não vê nada de errado,
 * porque ela protege a LINHA, não o número.
 */
const TRAVA_CUNHAGEM = sql`pg_advisory_xact_lock(hashtext('pralis:codigo_cadastro'))`;

@injectable()
export class CodigoCadastroRepository implements CodigoCadastroRepo {
  constructor(@inject(ProductSheetService) private sheets: ProductSheetService) {}

  /**
   * Quem entra na reconciliação: **a BASE e os órfãos** (produto de loja que
   * nunca veio da base).
   *
   * As cópias de loja ficam de fora de propósito. Elas herdam o código da BASE
   * (DB-04) e o `backfill-codigo-interno.ts` as reescreve a cada boot — listar
   * a cópia faria a mesma mercadoria aparecer duas ou três vezes, e decidir na
   * linha da loja produziria uma escolha que o próximo deploy desfaz sem aviso.
   *
   * `unificado` também sai: é cadastro aposentado, como em todo o resto do
   * sistema (`product.repository.ts`).
   */
  async listarProdutos(): Promise<ProdutoParaReconciliar[]> {
    return db.select({
      id: products.id,
      loja: products.loja,
      nome: products.nome,
      codigoBarras: products.codigoBarras,
      codigoInterno: products.codigoInterno,
    })
      .from(products)
      .where(and(isNull(products.baseProductId), ne(products.status, 'unificado')))
      .orderBy(products.loja, products.codigo);
  }

  /**
   * Todo o de-para do SIA, de todas as lojas.
   *
   * A unicidade por loja já é garantida no banco (`uq_sia_depara_barras`), então
   * ambiguidade dentro de uma loja é impossível — o que pode divergir é uma
   * loja contra a outra, e isso o motor trata como conflito para decisão humana.
   */
  async listarPares(): Promise<ParSia[]> {
    return db.select({
      loja: siaProdutoDePara.loja,
      coditem: siaProdutoDePara.coditem,
      chaveBarras: siaProdutoDePara.chaveBarras,
      descricao: siaProdutoDePara.descricao,
    }).from(siaProdutoDePara);
  }

  async maiorCodigo(): Promise<number> {
    const r = await db.execute(
      sql`SELECT COALESCE(MAX(CAST(codigo_interno AS INTEGER)), 0) AS max FROM products WHERE codigo_interno ~ '^[0-9]+$'`,
    );
    return Number((r.rows?.[0] as { max?: number | string } | undefined)?.max ?? 0);
  }

  async tetoSia(): Promise<number> {
    const r = await db.execute(
      sql`SELECT COALESCE(MAX(CAST(coditem AS BIGINT)), 0) AS max FROM sia_produto_depara
          WHERE coditem ~ '^[0-9]+$' AND CAST(coditem AS BIGINT) <= ${MAIOR_CODIGO_CADASTRO}`,
    );
    return Number((r.rows?.[0] as { max?: number | string } | undefined)?.max ?? 0);
  }

  async trocar(pedido: TrocaPedida): Promise<ResultadoTroca> {
    const resultado = await db.transaction(async (tx) => this.aplicar(tx, pedido));
    if (resultado.resultado === 'trocado') await this.enfileirarEspelho(resultado.espelhar);
    return resultado.resultado;
  }

  /** Cunhagem e gravação na MESMA transação, sob trava — ver `TRAVA_CUNHAGEM`. */
  async cunhar(pedido: Omit<TrocaPedida, 'codigoNovo'>, teto: number) {
    const { proximo, ...resto } = await db.transaction(async (tx) => {
      await tx.execute(TRAVA_CUNHAGEM);
      const r = await tx.execute(
        sql`SELECT COALESCE(MAX(CAST(codigo_interno AS INTEGER)), 0) AS max FROM products WHERE codigo_interno ~ '^[0-9]+$'`,
      );
      const maior = Number((r.rows?.[0] as { max?: number | string } | undefined)?.max ?? 0);
      const numero = Math.max(teto, maior) + 1;
      const codigoNovo = String(numero).padStart(5, '0');
      const aplicado = await this.aplicar(tx, { ...pedido, codigoNovo });
      return { proximo: codigoNovo, ...aplicado };
    });
    if (resto.resultado === 'trocado') await this.enfileirarEspelho(resto.espelhar);
    return { resultado: resto.resultado, codigo: proximo };
  }

  /**
   * Troca o código, registra o histórico e propaga para as cópias da loja.
   *
   * A propagação grava histórico POR CÓPIA: o código anterior que se perde é
   * justamente o da loja, que podia ser diferente do da BASE. Sem isso,
   * desfazer uma adoção recupera a BASE e deixa TNP/LI sem valor de volta.
   */
  private async aplicar(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    pedido: TrocaPedida,
  ): Promise<{ resultado: ResultadoTroca; espelhar: string[] }> {
    const esperado = pedido.codigoAnteriorEsperado;
    const atingidas = await tx.update(products)
      .set({ codigoInterno: pedido.codigoNovo })
      .where(and(
        eq(products.id, pedido.productId),
        esperado == null ? isNull(products.codigoInterno) : eq(products.codigoInterno, esperado),
      ))
      .returning({ id: products.id });
    if (atingidas.length === 0) return { resultado: 'mudou-embaixo', espelhar: [] };

    await tx.insert(productCodigoInternoHistory).values({
      productId: pedido.productId,
      loja: pedido.loja,
      codigoAnterior: esperado,
      codigoNovo: pedido.codigoNovo,
      fonte: pedido.fonte,
      alteradoPorUserId: pedido.alteradoPorUserId,
      alteradoPorNome: pedido.alteradoPorNome,
    });

    const espelhar = [pedido.productId];
    if (pedido.loja === 'BASE') {
      // lê ANTES de sobrescrever: é o único momento em que o código da loja existe
      const copias = await tx.select({ id: products.id, loja: products.loja, codigoInterno: products.codigoInterno })
        .from(products)
        .where(and(eq(products.baseProductId, pedido.productId), ne(products.loja, 'BASE')));
      for (const copia of copias) {
        if (soDigitos(copia.codigoInterno) === soDigitos(pedido.codigoNovo)) continue;
        await tx.update(products).set({ codigoInterno: pedido.codigoNovo }).where(eq(products.id, copia.id));
        await tx.insert(productCodigoInternoHistory).values({
          productId: copia.id,
          loja: copia.loja,
          codigoAnterior: copia.codigoInterno,
          codigoNovo: pedido.codigoNovo,
          fonte: `Propagação da BASE (${pedido.fonte})`,
          alteradoPorUserId: pedido.alteradoPorUserId,
          alteradoPorNome: pedido.alteradoPorNome,
        });
        espelhar.push(copia.id);
      }
    }
    return { resultado: 'trocado', espelhar };
  }

  /**
   * Enfileira o espelho DEPOIS do commit.
   *
   * O único consumidor conhecido do `codigo_interno` é a coluna AC da planilha
   * oficial (`product-sheet.mapper.ts`): trocar no banco sem enfileirar deixaria
   * a planilha e o sistema discordando exatamente no campo que esta tela existe
   * para arrumar. Falha aqui não desfaz a troca — o reenvio pega depois.
   */
  private async enfileirarEspelho(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        await this.sheets.registerPending(id);
      } catch {
        /* o reenvio periódico recupera; a troca no banco é o que não pode voltar atrás */
      }
    }
  }
}
