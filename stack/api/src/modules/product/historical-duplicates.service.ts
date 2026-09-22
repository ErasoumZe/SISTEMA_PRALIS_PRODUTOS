import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { ProductSheetService } from '@/modules/google-sheets/product-sheet.service';
import { productFiscal, productMerge, productTransformacao, products, promocoes } from './product.table';
import { confrontarHistoricos, type ConfrontoHistorico, type TipoConfrontoHistorico } from './historical-duplicates.motor';

const CONFIRMACAO = 'UNIFICAR CADASTROS HISTORICOS';
const LEGADO = { min: 1, max: 428 };
const SIA = { min: 10_000, max: 13_126 };
const numero = (codigo: string | null) => Number(String(codigo ?? '').replace(/\D/g, ''));
const naFaixa = (codigo: string | null, faixa: { min: number; max: number }) => Number.isInteger(numero(codigo)) && numero(codigo) >= faixa.min && numero(codigo) <= faixa.max;

export interface ItemConfrontoHistorico {
  legado: { id: string; codigoInterno: string; nome: string; codigoBarras: string | null };
  tipo: TipoConfrontoHistorico;
  candidato: { id: string; codigoInterno: string; nome: string; codigoBarras: string | null } | null;
  semelhanca: number | null;
}

export interface PreviaConfrontoHistorico {
  resumo: Record<TipoConfrontoHistorico, number>;
  tetoAtual: number;
  confirmacao: string;
  itens: ItemConfrontoHistorico[];
}

export interface PedidoUnificacaoHistorica {
  perdedorId: string;
  vencedorId: string;
  codigoPerdedorEsperado: string;
  codigoVencedorEsperado: string;
  confirmacao: string;
}

@injectable()
export class HistoricalDuplicatesService {
  constructor(@inject(ProductSheetService) private sheets: ProductSheetService) {}

  private async produtos(faixa: { min: number; max: number }) {
    return db.select({ id: products.id, codigoInterno: products.codigoInterno, nome: products.nome, codigoBarras: products.codigoBarras })
      .from(products)
      .where(and(
        eq(products.loja, 'BASE'),
        isNull(products.baseProductId),
        ne(products.status, 'unificado'),
        sql`${products.codigoInterno} ~ '^[0-9]+$'`,
        sql`CAST(${products.codigoInterno} AS INTEGER) BETWEEN ${faixa.min} AND ${faixa.max}`,
      ));
  }

  async previa(): Promise<PreviaConfrontoHistorico> {
    const [legados, sia, maior] = await Promise.all([
      this.produtos(LEGADO), this.produtos(SIA),
      db.execute(sql`SELECT COALESCE(MAX(CAST(codigo_interno AS INTEGER)), 0) AS max FROM products WHERE codigo_interno ~ '^[0-9]+$'`),
    ]);
    const confrontos = confrontarHistoricos(legados.map((p) => ({ ...p, codigoInterno: p.codigoInterno! })), sia.map((p) => ({ ...p, codigoInterno: p.codigoInterno! })));
    const resumo: Record<TipoConfrontoHistorico, number> = { 'barras-exatas': 0, 'nome-exato': 0, revisar: 0, 'sem-par': 0 };
    for (const item of confrontos) resumo[item.tipo] += 1;
    return {
      resumo,
      tetoAtual: Number((maior.rows?.[0] as { max?: number | string } | undefined)?.max ?? 0),
      confirmacao: CONFIRMACAO,
      itens: confrontos,
    };
  }

  async unificar(user: CurrentUser, pedido: PedidoUnificacaoHistorica, permitirRevisar = false) {
    if (user.role !== 'admin') throw new AppError('Apenas administrador pode unificar cadastros.', 403, 'FORBIDDEN');
    if (pedido.confirmacao.trim().toUpperCase() !== CONFIRMACAO) throw new AppError(`Digite "${CONFIRMACAO}" para confirmar.`, 400);

    const pendentes: string[] = [];
    await db.transaction(async (tx) => {
      const encontrados = await tx.select().from(products).where(sql`${products.id} IN (${pedido.perdedorId}, ${pedido.vencedorId})`);
      const perdedor = encontrados.find((p) => p.id === pedido.perdedorId);
      const vencedor = encontrados.find((p) => p.id === pedido.vencedorId);
      if (!perdedor || !vencedor || perdedor.loja !== 'BASE' || vencedor.loja !== 'BASE') throw new AppError('Os dois cadastros BASE não foram encontrados.', 404);
      if (perdedor.status === 'unificado') throw new AppError('O cadastro histórico já foi unificado.', 409);
      if (perdedor.codigoInterno !== pedido.codigoPerdedorEsperado || vencedor.codigoInterno !== pedido.codigoVencedorEsperado) throw new AppError('Um dos códigos mudou desde a prévia. Atualize a tela antes de confirmar.', 409);
      if (!naFaixa(perdedor.codigoInterno, LEGADO) || !naFaixa(vencedor.codigoInterno, SIA)) throw new AppError('A operação aceita apenas histórico 00001–00428 para SIA 10000–13126.', 422);

      const previa = await this.previa();
      const par = previa.itens.find((i) => i.legado.id === perdedor.id && i.candidato?.id === vencedor.id);
      const permitido = par?.tipo === 'barras-exatas' || par?.tipo === 'nome-exato' || (permitirRevisar && par?.tipo === 'revisar');
      if (!permitido) throw new AppError('Este par não pode ser unificado: precisa de evidência forte ou de seleção manual na aba Revisar.', 422);

      const [fiscal] = await tx.select().from(productFiscal).where(eq(productFiscal.productId, perdedor.id));
      const [transformacao] = await tx.select().from(productTransformacao).where(eq(productTransformacao.productId, perdedor.id));
      const promocoesPerdedor = await tx.select().from(promocoes).where(eq(promocoes.productId, perdedor.id));
      const copias = await tx.select().from(products).where(eq(products.baseProductId, perdedor.id));
      await tx.insert(productMerge).values({
        loja: 'BASE', vencedorProductId: vencedor.id, perdedorProductId: perdedor.id,
        snapshot: { produto: perdedor, fiscal, transformacao, promocoes: promocoesPerdedor, copias }, confirmadoPor: user.name,
      });
      await tx.update(products).set({ status: 'unificado', unificadoEmProductId: vencedor.id }).where(eq(products.id, perdedor.id));
      pendentes.push(vencedor.id, perdedor.id);

      for (const copia of copias) {
        const [destino] = await tx.select({ id: products.id }).from(products).where(and(eq(products.baseProductId, vencedor.id), eq(products.loja, copia.loja))).limit(1);
        if (destino) await tx.update(products).set({ status: 'unificado', unificadoEmProductId: destino.id }).where(eq(products.id, copia.id));
        else await tx.update(products).set({ baseProductId: vencedor.id, codigoInterno: vencedor.codigoInterno }).where(eq(products.id, copia.id));
        pendentes.push(copia.id);
      }
    });
    for (const id of pendentes) { try { await this.sheets.registerPending(id); } catch { /* reenvio recupera */ } }
    return { unificado: true };
  }

  /**
   * Lote de nomes idênticos: a prévia e o total esperado impedem que uma tela
   * antiga una mais (ou menos) produtos do que a pessoa conferiu.
   */
  async unificarNomesExatos(user: CurrentUser, totalEsperado: number, confirmacao: string) {
    if (user.role !== 'admin') throw new AppError('Apenas administrador pode unificar cadastros.', 403, 'FORBIDDEN');
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO) throw new AppError(`Digite "${CONFIRMACAO}" para confirmar.`, 400);
    const pares = (await this.previa()).itens.filter((item) => item.tipo === 'nome-exato' && item.candidato);
    if (pares.length !== totalEsperado) throw new AppError(`A prévia mudou: agora há ${pares.length} nome(s) exato(s). Atualize a tela e confirme de novo.`, 409);
    if (pares.length > 100) throw new AppError('O lote máximo é 100. A tela deve dividir o processamento.', 422);
    const resultados = await Promise.allSettled(pares.map((item) => this.unificar(user, {
      perdedorId: item.legado.id, vencedorId: item.candidato!.id,
      codigoPerdedorEsperado: item.legado.codigoInterno, codigoVencedorEsperado: item.candidato!.codigoInterno,
      confirmacao,
    })));
    const aplicados = resultados.filter((r) => r.status === 'fulfilled').length;
    const falhas = resultados.flatMap((r, indice) => r.status === 'rejected' ? [{ codigo: pares[indice]!.legado.codigoInterno, erro: r.reason instanceof Error ? r.reason.message : 'Falha desconhecida' }] : []);
    return { aplicados, falhas };
  }

  /** Lote explicitamente revisado por pessoa. Sem seleção, sem unificação por aproximação. */
  async unificarRevisados(user: CurrentUser, pedidos: PedidoUnificacaoHistorica[]) {
    if (user.role !== 'admin') throw new AppError('Apenas administrador pode unificar cadastros.', 403, 'FORBIDDEN');
    if (pedidos.length < 1 || pedidos.length > 100) throw new AppError('Selecione entre 1 e 100 pares por vez.', 422);
    const frase = pedidos[0]?.confirmacao ?? '';
    if (pedidos.some((p) => p.confirmacao !== frase) || frase.trim().toUpperCase() !== CONFIRMACAO) throw new AppError(`Digite "${CONFIRMACAO}" para confirmar.`, 400);
    const resultados = await Promise.allSettled(pedidos.map((pedido) => this.unificar(user, pedido, true)));
    const aplicados = resultados.filter((r) => r.status === 'fulfilled').length;
    const falhas = resultados.flatMap((r, indice) => r.status === 'rejected' ? [{ codigo: pedidos[indice]!.codigoPerdedorEsperado, erro: r.reason instanceof Error ? r.reason.message : 'Falha desconhecida' }] : []);
    return { aplicados, falhas };
  }
}
