import { injectable } from 'tsyringe';
import { and, eq, lt } from 'drizzle-orm';
import { db, type Tx } from '@/db/databases';
import { fechamentoCaixaDia, vendaProdutoDia } from './vendas.table';
import type { FechamentoCaixaInput, ImportarVendasResult, VendaProdutoInput } from './vendas.schemas';

type Loja = 'TNP' | 'LI';
type Action = 'inserted' | 'updated' | 'ignored';

const loja = (empresa: VendaProdutoInput['EMPRESA'] | FechamentoCaixaInput['EMPRESA']): Loja =>
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
    const [sameHash] = await tx.select({ id: fechamentoCaixaDia.id })
      .from(fechamentoCaixaDia).where(eq(fechamentoCaixaDia.hash, row.HASH)).limit(1);
    if (sameHash) return 'ignored';

    const derived = deriveOperador(row.OPERADOR);
    const natural = and(
      eq(fechamentoCaixaDia.loja, store),
      eq(fechamentoCaixaDia.data, row.DATA_VENDA),
      eq(fechamentoCaixaDia.pdv, row.PDV),
      eq(fechamentoCaixaDia.operador, row.OPERADOR),
    );
    const [existing] = await tx.select({ id: fechamentoCaixaDia.id })
      .from(fechamentoCaixaDia).where(natural).limit(1);
    const values = {
      loja: store, data: row.DATA_VENDA, pdv: row.PDV, operador: row.OPERADOR, ...derived,
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
    const updated = await tx.update(fechamentoCaixaDia)
      .set({ ...values, atualizadoEm: new Date() })
      .where(and(natural, lt(fechamentoCaixaDia.origemAtualizadaEm, row.ATUALIZADO_EM)))
      .returning({ id: fechamentoCaixaDia.id });
    return updated.length ? 'updated' : 'ignored';
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

