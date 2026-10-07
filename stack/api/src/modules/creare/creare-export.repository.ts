import { createHash } from 'node:crypto';
import { injectable } from 'tsyringe';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import type { CreareStore } from './creare.config';
import { creareExportBatch, creareExportDeliveryState, creareExportState, type CreareBatchItem } from './creare.table';

export interface PendingRecord {
  productId: string;
  record: string;
}

export interface CursorDiagnostico {
  /** Produtos que mudaram (ou nasceram) e ainda nao foram entregues. */
  pendentes: string[];
  cursorEntregue: number;
  cursorConfirmado: number;
  loteAberto: {
    id: string;
    registros: number;
    criadoEm: Date;
    idadeMinutos: number;
    formatoVersao: number;
    /** Passou da validade: o proximo download o cancela e recalcula. */
    abandonado: boolean;
  } | null;
  ultimaEntrega: { loteId: string; registros: number; em: Date } | null;
}

export type ExportBatch = typeof creareExportBatch.$inferSelect;

const digest = (value: string) => createHash('sha256').update(value, 'ascii').digest('hex');
// Versoes antigas escreveram Pesavel=N sem consultar o cadastro SIA.
// Nunca reutilizar nem confirmar um lote aberto daquela geracao.
const CURRENT_FORMAT_VERSION = 3;

/**
 * Por quanto tempo um lote sem entrega registrada continua valendo.
 *
 * `pending` devolve o lote aberto SEM recalcular nada: o conteudo e o que foi
 * apurado quando ele nasceu. Isso e proposital enquanto o robo esta no meio do
 * ciclo (baixar, verificar, salvar, registrar entrega) -- e o que impede dois
 * downloads de gerarem dois arquivos diferentes.
 *
 * O problema e quando a entrega NUNCA e registrada: o robo morre antes
 * (rede, 409, PC desligado) e o lote fica ocupando a vaga para sempre. A
 * partir dai nenhum produto novo entra em TXT nenhum, porque `pending` para no
 * lote aberto antes de olhar o catalogo -- e nada disso aparece em lugar
 * algum. Foi o que aconteceu com o MINI PAO DOCE GOTAS DE CHOCOLATE (13179)
 * em 07/10/2026.
 *
 * A tarefa agendada roda de 5 em 5 minutos e registra a entrega na mesma
 * execucao. 15 minutos sao tres ciclos: tempo de sobra para o caminho normal,
 * e curto o bastante para a loja nao passar o dia travada.
 *
 * Reciclar e seguro: cancelar um lote NAO avanca o cursor. Os produtos dele
 * continuam pendentes e voltam no lote seguinte. Se o robo chegou a salvar o
 * arquivo antes de morrer, o SIA so recebe os mesmos registros de novo, e a
 * importacao do Criare e upsert por CODITEM.
 */
const LOTE_ABERTO_VALIDADE_MINUTOS = 15;

const expirado = (criadoEm: Date, agora = Date.now()) =>
  agora - criadoEm.getTime() > LOTE_ABERTO_VALIDADE_MINUTOS * 60_000;

/** Serializa criacao e confirmacao por loja, inclusive entre instancias da API. */
async function lockStore(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], loja: CreareStore) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`creare-export:${loja}`}))`);
}

@injectable()
export class CreareExportRepository {
  /**
   * Lote que ainda vale para ser reentregue. Um lote abandonado (ver
   * `LOTE_ABERTO_VALIDADE_MINUTOS`) NAO conta como aberto: quem chamar cai no
   * `prepare`, que o cancela e apura o catalogo de novo.
   */
  async open(loja: CreareStore): Promise<ExportBatch | null> {
    const [batch] = await db.select().from(creareExportBatch)
      .where(and(eq(creareExportBatch.loja, loja), isNull(creareExportBatch.entregueEm),
        isNull(creareExportBatch.confirmadoEm),
        isNull(creareExportBatch.canceladoEm), eq(creareExportBatch.formatoVersao, CURRENT_FORMAT_VERSION))).limit(1);
    if (!batch) return null;
    return expirado(batch.criadoEm) ? null : batch;
  }

  /**
   * Estado do cursor incremental, sem criar nem alterar lote.
   *
   * Existe porque o `/creare/health` dizia "7181 casados, 0 invalidos" --- que
   * se le como "esta tudo exportado" --- sem saber nada sobre o incremental.
   * Produto valido, no lote, e ausente do TXT era um estado invisivel.
   */
  async cursor(loja: CreareStore, rows: PendingRecord[]): Promise<CursorDiagnostico> {
    const states = await db.select({ productId: creareExportDeliveryState.productId, hash: creareExportDeliveryState.hash })
      .from(creareExportDeliveryState).where(eq(creareExportDeliveryState.loja, loja));
    const delivered = new Map(states.map((item) => [item.productId, item.hash]));
    const pendentes = rows.filter((row) => delivered.get(row.productId) !== digest(row.record)).map((row) => row.productId);

    const [confirmados] = await db.select({ n: sql<number>`count(*)::int` })
      .from(creareExportState).where(eq(creareExportState.loja, loja));

    // Sem o filtro de validade de proposito: um lote abandonado e exatamente o
    // que precisa aparecer aqui, com a idade dele.
    const [aberto] = await db.select().from(creareExportBatch)
      .where(and(eq(creareExportBatch.loja, loja), isNull(creareExportBatch.entregueEm),
        isNull(creareExportBatch.confirmadoEm), isNull(creareExportBatch.canceladoEm))).limit(1);
    const [entrega] = await db.select().from(creareExportBatch)
      .where(and(eq(creareExportBatch.loja, loja), isNull(creareExportBatch.canceladoEm)))
      .orderBy(sql`${creareExportBatch.entregueEm} DESC NULLS LAST`).limit(1);

    return {
      pendentes,
      cursorEntregue: delivered.size,
      cursorConfirmado: confirmados?.n ?? 0,
      loteAberto: aberto
        ? {
            id: aberto.id,
            registros: aberto.itens.length,
            criadoEm: aberto.criadoEm,
            idadeMinutos: Math.floor((Date.now() - aberto.criadoEm.getTime()) / 60_000),
            formatoVersao: aberto.formatoVersao,
            abandonado: expirado(aberto.criadoEm),
          }
        : null,
      ultimaEntrega: entrega?.entregueEm
        ? { loteId: entrega.id, registros: entrega.itens.length, em: entrega.entregueEm }
        : null,
    };
  }

  async prepare(loja: CreareStore, rows: PendingRecord[], ending: string, limite?: number): Promise<ExportBatch | null> {
    return db.transaction(async (tx) => {
      await lockStore(tx, loja);
      const [open] = await tx.select().from(creareExportBatch)
        .where(and(eq(creareExportBatch.loja, loja), isNull(creareExportBatch.entregueEm),
          isNull(creareExportBatch.confirmadoEm),
          isNull(creareExportBatch.canceladoEm))).limit(1);
      if (open?.formatoVersao === CURRENT_FORMAT_VERSION && !expirado(open.criadoEm)) return open;
      if (open) {
        /*
         * Lote do formato anterior, ou abandonado sem registro de entrega:
         * manter historico, mas nunca servi-lo novamente nem aceitar sua
         * confirmacao como importacao correta.
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
        await tx.update(creareExportBatch).set({ canceladoEm: fechadoEm, confirmadoEm: fechadoEm, entregueEm: fechadoEm })
          .where(eq(creareExportBatch.id, open.id));
      }

      // Tambem cobre instalacoes que usam drizzle-kit push em vez do SQL de
      // migracao: a primeira consulta preserva o cursor ja confirmado.
      await tx.insert(creareExportDeliveryState)
        .select(tx.select({
          loja: creareExportState.loja,
          productId: creareExportState.productId,
          hash: creareExportState.hash,
          batchId: creareExportState.batchId,
          entregueEm: creareExportState.confirmadoEm,
        }).from(creareExportState).where(eq(creareExportState.loja, loja)))
        .onConflictDoNothing();
      const states = await tx.select({ productId: creareExportDeliveryState.productId, hash: creareExportDeliveryState.hash })
        .from(creareExportDeliveryState).where(eq(creareExportDeliveryState.loja, loja));
      const delivered = new Map(states.map((item) => [item.productId, item.hash]));
      const changed = rows.map((row) => ({ ...row, hash: digest(row.record) }))
        .filter((row) => delivered.get(row.productId) !== row.hash);
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

  /** Avanca o cursor somente apos o robo salvar e verificar o arquivo local. */
  async acknowledgeDelivery(loja: CreareStore, id: string, sha256: string): Promise<{ count: number; alreadyDelivered: boolean }> {
    return db.transaction(async (tx) => {
      await lockStore(tx, loja);
      const [batch] = await tx.select().from(creareExportBatch)
        .where(and(eq(creareExportBatch.id, id), eq(creareExportBatch.loja, loja))).limit(1);
      if (!batch) throw new AppError('Lote nao encontrado para esta loja.', 404, 'CREARE_BATCH_NOT_FOUND');
      if (batch.sha256 !== sha256) throw new AppError('Hash do TXT incorreto.', 409, 'CREARE_BATCH_HASH_MISMATCH');
      if (batch.canceladoEm || batch.formatoVersao !== CURRENT_FORMAT_VERSION) {
        throw new AppError('Lote cancelado ou em formato anterior.', 409, 'CREARE_BATCH_OUTDATED');
      }
      if (batch.entregueEm) return { count: batch.itens.length, alreadyDelivered: true };

      for (let i = 0; i < batch.itens.length; i += 500) {
        await tx.insert(creareExportDeliveryState).values(batch.itens.slice(i, i + 500).map((item) => ({
          loja, productId: item.productId, hash: item.hash, batchId: batch.id,
        }))).onConflictDoUpdate({
          target: [creareExportDeliveryState.loja, creareExportDeliveryState.productId],
          set: { hash: sql`excluded.hash`, batchId: sql`excluded.batch_id`, entregueEm: sql`now()` },
        });
      }
      await tx.update(creareExportBatch).set({ entregueEm: new Date() }).where(eq(creareExportBatch.id, id));
      return { count: batch.itens.length, alreadyDelivered: false };
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

      // Compatibilidade: confirmar um lote legado ainda nao entregue tambem
      // libera o cursor. Nunca retrocede um cursor ja avancado por outro lote.
      if (!batch.entregueEm) {
        for (let i = 0; i < batch.itens.length; i += 500) {
          await tx.insert(creareExportDeliveryState).values(batch.itens.slice(i, i + 500).map((item) => ({
            loja, productId: item.productId, hash: item.hash, batchId: batch.id,
          }))).onConflictDoUpdate({
            target: [creareExportDeliveryState.loja, creareExportDeliveryState.productId],
            set: { hash: sql`excluded.hash`, batchId: sql`excluded.batch_id`, entregueEm: sql`now()` },
          });
        }
      }

      for (let i = 0; i < batch.itens.length; i += 500) {
        await tx.insert(creareExportState).values(batch.itens.slice(i, i + 500).map((item) => ({
          loja, productId: item.productId, hash: item.hash, batchId: batch.id,
        }))).onConflictDoUpdate({
          target: [creareExportState.loja, creareExportState.productId],
          set: { hash: sql`excluded.hash`, batchId: sql`excluded.batch_id`, confirmadoEm: sql`now()` },
        });
      }
      await tx.update(creareExportBatch).set({ confirmadoEm: new Date(), entregueEm: batch.entregueEm ?? new Date() })
        .where(eq(creareExportBatch.id, id));
      return { count: batch.itens.length, alreadyConfirmed: false };
    });
  }
}
