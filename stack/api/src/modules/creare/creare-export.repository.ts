import { createHash } from 'node:crypto';
import { injectable } from 'tsyringe';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import type { CreareStore } from './creare.config';
import { creareExportBatch, creareExportState, type CreareBatchItem } from './creare.table';

export interface PendingRecord {
  productId: string;
  record: string;
}

export type ExportBatch = typeof creareExportBatch.$inferSelect;

const digest = (value: string) => createHash('sha256').update(value, 'ascii').digest('hex');
const CURRENT_FORMAT_VERSION = 2;

/** Serializa criacao e confirmacao por loja, inclusive entre instancias da API. */
async function lockStore(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], loja: CreareStore) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`creare-export:${loja}`}))`);
}

@injectable()
export class CreareExportRepository {
  async open(loja: CreareStore): Promise<ExportBatch | null> {
    const [batch] = await db.select().from(creareExportBatch)
      .where(and(eq(creareExportBatch.loja, loja), isNull(creareExportBatch.confirmadoEm),
        isNull(creareExportBatch.canceladoEm), eq(creareExportBatch.formatoVersao, CURRENT_FORMAT_VERSION))).limit(1);
    return batch ?? null;
  }

  async prepare(loja: CreareStore, rows: PendingRecord[], ending: string, limite?: number): Promise<ExportBatch | null> {
    return db.transaction(async (tx) => {
      await lockStore(tx, loja);
      const [open] = await tx.select().from(creareExportBatch)
        .where(and(eq(creareExportBatch.loja, loja), isNull(creareExportBatch.confirmadoEm),
          isNull(creareExportBatch.canceladoEm))).limit(1);
      if (open?.formatoVersao === CURRENT_FORMAT_VERSION) return open;
      if (open) {
        /*
         * Lote gerado pelo formato anterior: manter historico, mas nunca servi-lo
         * novamente nem aceitar sua confirmacao como importacao correta.
         *
         * FECHA as duas datas, nao so `cancelado_em`. O indice unico de "lote
         * aberto por loja" existe em duas versoes: a de 0028 olha so
         * `confirmado_em IS NULL`; a de 0029 olha as duas datas. Em producao o
         * `drizzle-kit push` conservou a versao antiga (28/09/2026), e um lote
         * cancelado com `confirmado_em` nulo continuava ocupando a vaga -- o
         * insert do lote novo estourava o indice e a rota devolvia 500. Com as
         * duas datas preenchidas, o lote sai da vaga em qualquer das versoes.
         * `cancelado_em` continua sendo o que diz "nao confie neste lote": e
         * ele que `confirm` e `open` consultam.
         */
        const fechadoEm = new Date();
        await tx.update(creareExportBatch).set({ canceladoEm: fechadoEm, confirmadoEm: fechadoEm })
          .where(eq(creareExportBatch.id, open.id));
      }

      const states = await tx.select({ productId: creareExportState.productId, hash: creareExportState.hash })
        .from(creareExportState).where(eq(creareExportState.loja, loja));
      const confirmed = new Map(states.map((item) => [item.productId, item.hash]));
      const changed = rows.map((row) => ({ ...row, hash: digest(row.record) }))
        .filter((row) => confirmed.get(row.productId) !== row.hash);
      const pending = limite ? changed.slice(0, limite) : changed;
      if (!pending.length) return null;

      const conteudo = `${pending.map((row) => row.record).join(ending)}${ending}`;
      const itens: CreareBatchItem[] = pending.map(({ productId, hash }) => ({ productId, hash }));
      const [batch] = await tx.insert(creareExportBatch).values({
        loja, conteudo, sha256: digest(conteudo), itens, formatoVersao: CURRENT_FORMAT_VERSION,
      }).returning();
      return batch!;
    });
  }

  async confirm(loja: CreareStore, id: string, sha256: string): Promise<{ count: number; alreadyConfirmed: boolean }> {
    return db.transaction(async (tx) => {
      await lockStore(tx, loja);
      const [batch] = await tx.select().from(creareExportBatch)
        .where(and(eq(creareExportBatch.id, id), eq(creareExportBatch.loja, loja))).limit(1);
      if (!batch) throw new AppError('Lote nao encontrado para esta loja.', 404, 'CREARE_BATCH_NOT_FOUND');
      if (batch.sha256 !== sha256) {
        throw new AppError('O hash do TXT nao corresponde ao lote. Nada foi confirmado.', 409, 'CREARE_BATCH_HASH_MISMATCH');
      }
      // cancelado vem ANTES de confirmado: o lote cancelado carrega as duas datas
      // (ver `prepare`), e ler `confirmado_em` primeiro o faria passar por importado
      if (batch.canceladoEm || batch.formatoVersao !== CURRENT_FORMAT_VERSION) {
        throw new AppError('Lote em formato anterior cancelado. Baixe o TXT corrigido antes de importar.',
          409, 'CREARE_BATCH_OUTDATED');
      }
      if (batch.confirmadoEm) return { count: batch.itens.length, alreadyConfirmed: true };

      for (let i = 0; i < batch.itens.length; i += 500) {
        await tx.insert(creareExportState).values(batch.itens.slice(i, i + 500).map((item) => ({
          loja, productId: item.productId, hash: item.hash, batchId: batch.id,
        }))).onConflictDoUpdate({
          target: [creareExportState.loja, creareExportState.productId],
          set: { hash: sql`excluded.hash`, batchId: sql`excluded.batch_id`, confirmadoEm: sql`now()` },
        });
      }
      await tx.update(creareExportBatch).set({ confirmadoEm: new Date() })
        .where(eq(creareExportBatch.id, id));
      return { count: batch.itens.length, alreadyConfirmed: false };
    });
  }
}
