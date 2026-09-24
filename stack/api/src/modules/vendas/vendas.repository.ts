import { injectable } from 'tsyringe';
import { and, eq, lt } from 'drizzle-orm';
import { db, type Tx } from '@/db/databases';
import { fechamentoCaixaDia, vendaItemPdv, vendaProdutoDia } from './vendas.table';
import type { FechamentoCaixaInput, ImportarVendasResult, VendaItemPdvInput, VendaProdutoInput } from './vendas.schemas';

type Loja = 'TNP' | 'LI';
type Action = 'inserted' | 'updated' | 'ignored';

const loja = (empresa: VendaProdutoInput['EMPRESA'] | FechamentoCaixaInput['EMPRESA'] | VendaItemPdvInput['EMPRESA']): Loja =>
  empresa === 'TNP CENTRAL' ? 'TNP' : 'LI';

function result(recebidas: number): ImportarVendasResult {
  return { recebidas, inseridas: 0, atualizadas: 0, ignoradas: 0 };
}

function count(output: ImportarVendasResult, action: Action) {
  if (action === 'inserted') output.inseridas += 1;
  else if (action === 'updated') output.atualizadas += 1;
  else output.ignoradas += 1;
}

@injectable()
export class VendasRepository {
  async importarVendas(rows: VendaProdutoInput[]): Promise<ImportarVendasResult> {
    return db.transaction(async (tx) => {
      const output = result(rows.length);
      for (const row of rows) count(output, await this.upsertVenda(tx, row));
      return output;
    });
  }

  async importarFechamentos(rows: FechamentoCaixaInput[]): Promise<ImportarVendasResult> {
    return db.transaction(async (tx) => {
      const output = result(rows.length);
      for (const row of rows) count(output, await this.upsertFechamento(tx, row));
      return output;
    });
  }

  async importarItensPdv(rows: VendaItemPdvInput[]): Promise<ImportarVendasResult> {
    return db.transaction(async (tx) => {
      const output = result(rows.length);
      for (const row of rows) count(output, await this.upsertItemPdv(tx, row));
      return output;
    });
  }

  private async upsertItemPdv(tx: Tx, row: VendaItemPdvInput): Promise<Action> {
    const store = loja(row.EMPRESA);
    const values = {
      loja: store,
      vendaIdErp: row.ID_VENDA_BALCAO,
      itemIdErp: row.ID_ITEM_VENDA_BALCAO,
      dispositivoIdErp: row.ID_DISPOSITIVO,
      pdv: row.PDV,
      vendidoEm: row.DATA_HORA_VENDA,
      produtoIdErp: row.PRODUTO_ID_ERP,
      produtoCodigo: row.PRODUTO_CODIGO,
      produto: row.PRODUTO,
      quantidade: row.QUANTIDADE,
      valorUnitario: row.VALOR_UNITARIO,
      total: row.TOTAL,
      itemCancelado: row.ITEM_CANCELADO,
      vendaStatus: row.VENDA_STATUS,
      vendaConfirmada: row.VENDA_CONFIRMADA,
      origemAtualizadaEm: row.ATUALIZADO_EM,
    };
    const inserted = await tx.insert(vendaItemPdv).values(values)
      .onConflictDoNothing().returning({ id: vendaItemPdv.id });
    if (inserted.length) return 'inserted';
    const updated = await tx.update(vendaItemPdv)
      .set({ ...values, atualizadoEm: new Date() })
      .where(and(
        eq(vendaItemPdv.loja, store),
        eq(vendaItemPdv.itemIdErp, row.ID_ITEM_VENDA_BALCAO),
        lt(vendaItemPdv.origemAtualizadaEm, row.ATUALIZADO_EM),
      )).returning({ id: vendaItemPdv.id });
    return updated.length ? 'updated' : 'ignored';
  }

  private async upsertVenda(tx: Tx, row: VendaProdutoInput): Promise<Action> {
    const store = loja(row.EMPRESA);
    const [sameHash] = await tx.select({ id: vendaProdutoDia.id })
      .from(vendaProdutoDia).where(eq(vendaProdutoDia.hash, row.HASH)).limit(1);
    if (sameHash) return 'ignored';

    const natural = and(
      eq(vendaProdutoDia.loja, store),
      eq(vendaProdutoDia.data, row.DATA_VENDA),
      eq(vendaProdutoDia.produtoCodigo, row.PRODUTO_CODIGO),
      eq(vendaProdutoDia.produto, row.PRODUTO),
    );
    const [existing] = await tx.select({ id: vendaProdutoDia.id, source: vendaProdutoDia.origemAtualizadaEm })
      .from(vendaProdutoDia).where(natural).limit(1);
    const values = {
      loja: store, data: row.DATA_VENDA, produtoCodigo: row.PRODUTO_CODIGO, produto: row.PRODUTO,
      quantidade: row.QUANTIDADE, valorUnitario: row.VALOR_UNITARIO, total: row.TOTAL,
      produtoIdErp: row.PRODUTO_ID_ERP ?? '',
      hash: row.HASH, origemAtualizadaEm: row.ATUALIZADO_EM,
    };
    if (!existing) {
      await tx.insert(vendaProdutoDia).values(values);
      return 'inserted';
    }
    const updated = await tx.update(vendaProdutoDia)
      .set({ ...values, atualizadoEm: new Date() })
      .where(and(natural, lt(vendaProdutoDia.origemAtualizadaEm, row.ATUALIZADO_EM)))
      .returning({ id: vendaProdutoDia.id });
    return updated.length ? 'updated' : 'ignored';
  }

  private async upsertFechamento(tx: Tx, row: FechamentoCaixaInput): Promise<Action> {
    const store = loja(row.EMPRESA);
    const derived = deriveOperador(row.OPERADOR);
    const natural = and(
      eq(fechamentoCaixaDia.loja, store),
      eq(fechamentoCaixaDia.data, row.DATA_VENDA),
      eq(fechamentoCaixaDia.pdv, row.PDV),
      eq(fechamentoCaixaDia.operador, row.OPERADOR),
    );
    const [existing] = await tx.select({ id: fechamentoCaixaDia.id, dispositivoIdErp: fechamentoCaixaDia.dispositivoIdErp })
      .from(fechamentoCaixaDia).where(natural).limit(1);
    const values = {
      loja: store, data: row.DATA_VENDA, pdv: row.PDV, dispositivoIdErp: row.ID_DISPOSITIVO || existing?.dispositivoIdErp || '', operador: row.OPERADOR, ...derived,
      primeiraVenda: row.PRIMEIRA_VENDA, ultimaVenda: row.ULTIMA_VENDA, numeroVendas: row.NUMERO_VENDAS,
      crediario: row.CREDIARIO, credito: row.CREDITO, debito: row.DEBITO, dinheiro: row.DINHEIRO,
      pix: row.PIX, voucher: row.VOUCHER, clientes: row.CLIENTES, colaboradores: row.COLABORADORES,
      alimentacao: row.ALIMENTACAO, rouboFurto: row.ROUBO_FURTO, socios: row.SOCIOS,
      sobraPerda: row.SOBRA_PERDA, outros: row.OUTROS, totalPagamento: row.TOTAL_PAGAMENTO,
      hash: row.HASH, origemAtualizadaEm: row.ATUALIZADO_EM,
    };
    if (!existing) {
      await tx.insert(fechamentoCaixaDia).values(values);
      return 'inserted';
    }
    // O robô antigo não enviava o ID do dispositivo. Backfill da identidade
    // pode chegar com timestamp antigo; nunca substituir totais mais recentes.
    const identidadePreenchida = row.ID_DISPOSITIVO && !existing.dispositivoIdErp
      ? await tx.update(fechamentoCaixaDia)
        .set({ dispositivoIdErp: row.ID_DISPOSITIVO })
        .where(and(natural, eq(fechamentoCaixaDia.dispositivoIdErp, '')))
        .returning({ id: fechamentoCaixaDia.id })
      : [];
    const updated = await tx.update(fechamentoCaixaDia)
      .set({ ...values, atualizadoEm: new Date() })
      .where(and(natural, lt(fechamentoCaixaDia.origemAtualizadaEm, row.ATUALIZADO_EM)))
      .returning({ id: fechamentoCaixaDia.id });
    return updated.length || identidadePreenchida.length ? 'updated' : 'ignored';
  }
}

export function deriveOperador(operador: string): { natureza: 'posto' | 'canal' | 'nominal'; caixa: string | null; turno: string | null } {
  const match = operador.trim().match(/^VND\s+CAIXA\s+PDV\s*-\s*(\d+)\s*([MT])$/i);
  if (match) return { natureza: 'posto', caixa: match[1]!, turno: match[2]!.toUpperCase() };
  const channel = operador.trim().toUpperCase();
  if (['TOTEN', 'BURPIZ', 'PEDIDO MESA', 'CAIXA_UNICO'].includes(channel)) {
    return { natureza: 'canal', caixa: null, turno: null };
  }
  return { natureza: 'nominal', caixa: null, turno: null };
}
