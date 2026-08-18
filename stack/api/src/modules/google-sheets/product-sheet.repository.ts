import { injectable } from 'tsyringe';
import { eq, sql } from 'drizzle-orm';
import { db, Tx } from '@/db/databases';
import { productSheetSync, type ProductSheetSyncRow } from './product-sheet-sync.table';

export type SheetSyncStatus = 'pending' | 'synced' | 'failed';

export interface EnsurePendingInput {
  productId: string;
  spreadsheetId: string;
  sheetName: string;
}

/**
 * Acesso à tabela `product_sheet_sync`. Não fala com o Google — só registra
 * onde/como o produto foi espelhado.
 */
@injectable()
export class ProductSheetRepository {
  /**
   * Cria (ou reabre) o registro `pending`. Aceita `tx` para participar da MESMA
   * transação da criação do produto.
   * Em reenvio, preserva rowNumber/attempts e volta o status para `pending`.
   */
  async ensurePending(input: EnsurePendingInput, tx: Tx = db): Promise<void> {
    await tx
      .insert(productSheetSync)
      .values({
        productId: input.productId,
        spreadsheetId: input.spreadsheetId,
        sheetName: input.sheetName,
        status: 'pending',
      })
      .onConflictDoUpdate({
        target: productSheetSync.productId,
        set: {
          spreadsheetId: input.spreadsheetId,
          sheetName: input.sheetName,
          status: 'pending',
          updatedAt: sql`now()`,
        },
      });
  }

  async findByProductId(productId: string, tx: Tx = db): Promise<ProductSheetSyncRow | null> {
    const [row] = await tx
      .select()
      .from(productSheetSync)
      .where(eq(productSheetSync.productId, productId))
      .limit(1);
    return row ?? null;
  }

  /** Sucesso: guarda a linha usada, zera o erro e carimba synced_at. */
  async markSynced(productId: string, rowNumber: number, tx: Tx = db): Promise<void> {
    await tx
      .update(productSheetSync)
      .set({
        status: 'synced',
        rowNumber,
        lastError: null,
        attempts: sql`${productSheetSync.attempts} + 1`,
        syncedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(productSheetSync.productId, productId));
  }

  /** Falha: mantém o produto salvo, conta a tentativa e guarda a mensagem sanitizada. */
  async markFailed(productId: string, lastError: string, tx: Tx = db): Promise<void> {
    await tx
      .update(productSheetSync)
      .set({
        status: 'failed',
        lastError,
        attempts: sql`${productSheetSync.attempts} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(productSheetSync.productId, productId));
  }

  /** Guarda a linha reservada antes mesmo de concluir a escrita (evita reclaim em retry). */
  async setRowNumber(productId: string, rowNumber: number, tx: Tx = db): Promise<void> {
    await tx
      .update(productSheetSync)
      .set({ rowNumber, updatedAt: sql`now()` })
      .where(eq(productSheetSync.productId, productId));
  }
}
