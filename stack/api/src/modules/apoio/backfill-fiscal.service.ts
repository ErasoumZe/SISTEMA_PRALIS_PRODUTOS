import { inject, injectable } from 'tsyringe';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { products, productFiscal } from '@/modules/product/product.table';
import { ProductRepository } from '@/modules/product/product.repository';
import { ProductSheetRepository } from '@/modules/google-sheets/product-sheet.repository';
import { env } from '@/config/env';
import { TaxRuleService, type EstadoFiscal } from './tax-rule.service';

/**
 * Backfill da carga fiscal dos produtos que nunca a receberam.
 *
 * Abrir e salvar produto a produto resolve um de cada vez; são 1.200 no
 * catálogo. Isto faz o mesmo caminho, em lote, com as travas que uma operação
 * em massa exige: conferência por padrão, retomada por cursor e registro do que
 * mudou.
 *
 * O QUE ELE NÃO FAZ:
 *  - não escreve na planilha direto. Enfileira pelo mecanismo que já existe
 *    (`product_sheet_sync`), porque milhares de chamadas ao Google dentro de
 *    uma requisição web estouram cota e derrubam o pedido;
 *  - não toca em produto que JÁ tem carga fiscal. Completar é ato único;
 *  - não inventa nada: onde a fonte cala, grava a pendência com o motivo.
 */

export interface FiltroBackfill {
  /** Só este produto. Serve para o canário. */
  productId?: string;
  loja?: string;
  limite?: number;
  /** Retomada: continua depois deste id. Vem do `proximoCursor` da rodada anterior. */
  cursor?: string;
}

export interface ResultadoBackfill {
  aplicou: boolean;
  analisados: number;
  /** Por estado resultante — é o relatório agregado por motivo. */
  porEstado: Record<string, number>;
  /** Produtos que mudariam (ou mudaram) de estado. */
  alterados: Array<{ id: string; nome: string; de: string; para: EstadoFiscal; motivo: string }>;
  proximoCursor: string | null;
}

/** Estados que ainda pedem uma tentativa. `completo` e as pendências humanas não. */
const PEDEM_TENTATIVA: EstadoFiscal[] = [
  'nao_classificado', 'parcial', 'fonte_indisponivel',
];

@injectable()
export class BackfillFiscalService {
  constructor(
    @inject(TaxRuleService) private taxRules: TaxRuleService,
    @inject(ProductRepository) private produtos: ProductRepository,
    @inject(ProductSheetRepository) private sync: ProductSheetRepository,
  ) {}

  /**
   * Quem entra na rodada.
   *
   * Ordenado por `id` e cortado pelo cursor: é o que torna a retomada possível
   * sem repetir nem pular. Ordenar por qualquer coluna mutável (estado, data)
   * faria o item mudar de lugar no meio da paginação.
   */
  private async elegiveis(f: FiltroBackfill) {
    const onde = [
      f.productId ? eq(products.id, f.productId) : undefined,
      f.loja ? eq(products.loja, f.loja) : undefined,
      f.cursor ? gt(products.id, f.cursor) : undefined,
      // produto sem linha fiscal nenhuma também entra: é o caso de quem nunca
      // foi classificado
      f.productId ? undefined : or(
        isNull(productFiscal.productId),
        isNull(productFiscal.estado),
        inArray(productFiscal.estado, PEDEM_TENTATIVA),
      ),
    ].filter(Boolean);

    return db
      .select({
        id: products.id,
        nome: products.nome,
        loja: products.loja,
        grupo: products.grupo,
        codigoBarras: products.codigoBarras,
        codigoInterno: products.codigoInterno,
        estado: productFiscal.estado,
      })
      .from(products)
      .leftJoin(productFiscal, eq(productFiscal.productId, products.id))
      .where(onde.length ? and(...onde) : undefined)
      .orderBy(asc(products.id))
      .limit(Math.min(500, Math.max(1, f.limite ?? 100)));
  }

  /**
   * @param aplicar `false` (padrão) só relata. É a trava principal: uma
   * operação que reescreve fiscal de mil produtos não pode ser o caminho fácil.
   */
  async executar(f: FiltroBackfill, aplicar = false): Promise<ResultadoBackfill> {
    const fila = await this.elegiveis(f);
    const porEstado: Record<string, number> = {};
    const alterados: ResultadoBackfill['alterados'] = [];

    for (const p of fila) {
      const r = await this.taxRules.classificar({
        nome: p.nome,
        codigoBarras: p.codigoBarras,
        codigoInterno: p.codigoInterno,
        grupo: p.grupo,
        loja: p.loja,
      });
      porEstado[r.estado] = (porEstado[r.estado] ?? 0) + 1;

      const mudou = r.estado !== (p.estado ?? 'nao_classificado');
      const ganhouCarga = !!r.classificacao?.ecf;
      if (!mudou && !ganhouCarga) continue;

      alterados.push({
        id: p.id,
        nome: p.nome,
        de: p.estado ?? '(sem registro)',
        para: r.estado,
        motivo: r.motivo,
      });

      if (!aplicar) continue;

      /*
       * Grava o fiscal pelo MESMO caminho do cadastro comum. Um caminho próprio
       * aqui divergiria do outro com o tempo, e o backfill passaria a produzir
       * produto diferente do que a tela produz.
       */
      const ecf = r.classificacao?.ecf ?? null;
      const classificacao = r.classificacao;
      await db
        .insert(productFiscal)
        .values({
          productId: p.id,
          estado: r.estado,
          motivo: r.motivo,
          conferidoEm: new Date(),
          ...(classificacao ? {
            ncm: classificacao.ncm,
            cstPisCofins: classificacao.cstPisCofins,
            tributacaoSimples: classificacao.tributacaoSimples,
            aliquotaSimples: String(classificacao.aliquotaSimples),
            icmsRe: String(classificacao.icmsRe),
            baseFiscal: classificacao.baseFiscal,
            codigoFiscal: classificacao.codigoFiscal,
            produtoFiscal: classificacao.produtoFiscal,
            cstReforma: classificacao.cstReforma,
            cClassTrib: classificacao.cClassTrib,
            aliquotaIbs: classificacao.aliquotaIbs == null ? null : String(classificacao.aliquotaIbs),
            aliquotaCbs: classificacao.aliquotaCbs == null ? null : String(classificacao.aliquotaCbs),
            origemFiscal: classificacao.origem,
          } : {}),
          ...(ecf ? {
            reducaoIcms: ecf.reducaoIcms == null ? null : String(ecf.reducaoIcms),
            aliquotaCheia: ecf.aliquotaCheia == null ? null : String(ecf.aliquotaCheia),
            aliquotaFcp: ecf.aliquotaFcp == null ? null : String(ecf.aliquotaFcp),
            aliquotaPis: ecf.aliquotaPis == null ? null : String(ecf.aliquotaPis),
            aliquotaCofins: ecf.aliquotaCofins == null ? null : String(ecf.aliquotaCofins),
            aliquotaEcf: ecf.aliquotaEcf,
            aliquotaEcfId: ecf.aliquotaEcfId,
            categoria: ecf.categoria,
            pctNcm: ecf.pctNcm == null ? null : String(ecf.pctNcm),
            icms: ecf.icms == null ? null : String(ecf.icms),
            cest: ecf.cest,
          } : {}),
        })
        .onConflictDoUpdate({
          target: productFiscal.productId,
          set: {
            estado: r.estado,
            motivo: r.motivo,
            conferidoEm: new Date(),
            ...(classificacao ? {
              ncm: classificacao.ncm,
              cstPisCofins: classificacao.cstPisCofins,
              tributacaoSimples: classificacao.tributacaoSimples,
              aliquotaSimples: String(classificacao.aliquotaSimples),
              icmsRe: String(classificacao.icmsRe),
              baseFiscal: classificacao.baseFiscal,
              codigoFiscal: classificacao.codigoFiscal,
              produtoFiscal: classificacao.produtoFiscal,
              cstReforma: classificacao.cstReforma,
              cClassTrib: classificacao.cClassTrib,
              aliquotaIbs: classificacao.aliquotaIbs == null ? null : String(classificacao.aliquotaIbs),
              aliquotaCbs: classificacao.aliquotaCbs == null ? null : String(classificacao.aliquotaCbs),
              origemFiscal: classificacao.origem,
            } : {}),
            ...(ecf ? {
              reducaoIcms: ecf.reducaoIcms == null ? null : String(ecf.reducaoIcms),
              aliquotaCheia: ecf.aliquotaCheia == null ? null : String(ecf.aliquotaCheia),
              aliquotaFcp: ecf.aliquotaFcp == null ? null : String(ecf.aliquotaFcp),
              aliquotaPis: ecf.aliquotaPis == null ? null : String(ecf.aliquotaPis),
              aliquotaCofins: ecf.aliquotaCofins == null ? null : String(ecf.aliquotaCofins),
              aliquotaEcf: ecf.aliquotaEcf,
              aliquotaEcfId: ecf.aliquotaEcfId,
              categoria: ecf.categoria,
              pctNcm: ecf.pctNcm == null ? null : String(ecf.pctNcm),
              icms: ecf.icms == null ? null : String(ecf.icms),
              cest: ecf.cest,
            } : {}),
          },
        });

      // a planilha é atualizada pela FILA, não aqui: o reenvio automático já
      // sabe respeitar cota e tentar de novo
      await this.sync.ensurePending({
        productId: p.id,
        spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
        sheetName: env.GOOGLE_SHEETS_BASE_TAB,
      }).catch(() => {});
    }

    return {
      aplicou: aplicar,
      analisados: fila.length,
      porEstado,
      alterados,
      proximoCursor: fila.length ? fila[fila.length - 1]!.id : null,
    };
  }

  /** Quantos produtos há em cada estado hoje. É o health fiscal. */
  async panorama(): Promise<Record<string, number>> {
    const linhas = await db
      .select({
        estado: sql<string>`coalesce(${productFiscal.estado}, 'sem_registro')`,
        quantos: sql<number>`count(*)::int`,
      })
      .from(products)
      .leftJoin(productFiscal, eq(productFiscal.productId, products.id))
      .groupBy(sql`coalesce(${productFiscal.estado}, 'sem_registro')`);
    return Object.fromEntries(linhas.map((l) => [l.estado, Number(l.quantos)]));
  }
}
