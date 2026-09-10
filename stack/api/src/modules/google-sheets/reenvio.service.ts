import { inject, injectable } from 'tsyringe';
import { and, asc, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { productSheetSync } from './product-sheet-sync.table';
import { ProductSheetService } from './product-sheet.service';

/**
 * Reenvio automático do que a planilha não aceitou.
 *
 * A tabela `product_sheet_sync` já era uma outbox — tinha `status`, `attempts`
 * e `lastError` — mas ninguém a lia de volta. Quando o Google falhava, a tela
 * avisava "sincronização pendente" e a linha ficava ali, esperando alguém abrir
 * o produto e salvar de novo. Na prática, ninguém abria.
 *
 * Aqui só existe o que faltava: escolher quem tentar de novo, tentar, e parar
 * de tentar quando não adianta mais.
 */

/** Quantas tentativas antes de considerar que insistir não resolve. */
export const TETO_TENTATIVAS = 8;

/**
 * Espera antes da PRÓXIMA tentativa, em minutos, por número de tentativas.
 *
 * Cresce porque as falhas do Sheets são quase sempre de dois tipos: passageira
 * (rede, cota do minuto) ou permanente (aba renomeada, permissão retirada). A
 * primeira passa em segundos; a segunda não passa nunca. Reenviar de imediato
 * atende mal aos dois casos — queima cota da API brigando com um erro que não
 * vai ceder, e ainda atrasa quem só precisava de um segundo.
 */
export const esperaEmMinutos = (tentativas: number): number =>
  Math.min(2 ** Math.max(0, tentativas - 1), 60);

export interface ResultadoReenvio {
  tentados: number;
  sincronizados: number;
  falharam: number;
  desistidos: number;
}

@injectable()
export class ReenvioSheetsService {
  constructor(@inject(ProductSheetService) private sheets: ProductSheetService) {}

  /**
   * Quem está esperando reenvio AGORA: pendente ou falhado, abaixo do teto de
   * tentativas e com a espera já cumprida.
   */
  async aguardando(limite = 50): Promise<string[]> {
    const linhas = await db
      .select({ productId: productSheetSync.productId })
      .from(productSheetSync)
      .where(and(
        inArray(productSheetSync.status, ['pending', 'failed']),
        lt(productSheetSync.attempts, TETO_TENTATIVAS),
        /*
         * A espera é calculada no banco a partir de `attempts`, e não em
         * memória: assim duas execuções simultâneas enxergam a mesma fila e
         * não brigam pela mesma linha logo depois de uma delas falhar.
         */
        or(
          sql`${productSheetSync.attempts} = 0`,
          sql`${productSheetSync.updatedAt} < now() - (least(power(2, greatest(${productSheetSync.attempts} - 1, 0)), 60) * interval '1 minute')`,
        ),
      ))
      .orderBy(asc(productSheetSync.updatedAt))
      .limit(limite);
    return linhas.map((l) => l.productId);
  }

  /** Quantos desistiram: bateram no teto e não serão mais tentados sozinhos. */
  async desistidos(): Promise<number> {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(productSheetSync)
      .where(and(
        inArray(productSheetSync.status, ['pending', 'failed']),
        sql`${productSheetSync.attempts} >= ${TETO_TENTATIVAS}`,
      ));
    return Number(r?.n ?? 0);
  }

  /**
   * Tenta de novo, um a um.
   *
   * SEQUENCIAL de propósito: `syncProduct` já entra na fila interna do serviço
   * de planilha, e disparar em paralelo só empilharia espera lá dentro — com o
   * bônus de estourar a cota por minuto do Sheets.
   *
   * Nunca lança: é rotina de fundo. Uma falha aqui vira contagem, não exceção
   * que derruba o processo.
   */
  async reprocessar(limite = 50): Promise<ResultadoReenvio> {
    const fila = await this.aguardando(limite);
    let sincronizados = 0;
    let falharam = 0;

    for (const productId of fila) {
      try {
        const r = await this.sheets.syncProduct(productId);
        if (r.outcome === 'synced') sincronizados += 1;
        else falharam += 1;
      } catch {
        // `syncProduct` já registra o erro na própria linha da fila
        falharam += 1;
      }
    }

    return {
      tentados: fila.length,
      sincronizados,
      falharam,
      desistidos: await this.desistidos(),
    };
  }
}
