import { injectable } from 'tsyringe';
import { and, eq, ilike, inArray, or, desc } from 'drizzle-orm';
import { db, Tx } from '@/db/databases';
import { ProductSchemas, ProductRequests } from '@pralis/shared';
import {
  products, productLojas, productTransformacao, productFiscal, promocoes,
} from './product.table';

type ProductEntity = ProductSchemas.ProductEntity;
type LojaComercial = ProductSchemas.LojaComercial;
type Promocao = ProductSchemas.Promocao;

// ---- helpers de conversão (Drizzle numeric vem como string) ----
const num = (v: string | null): number | null => (v == null ? null : Number(v));
const toDb = (n: number | null | undefined): string | null => (n == null ? null : String(n));

function mapProduct(row: typeof products.$inferSelect): Omit<ProductEntity, 'lojas' | 'transformacao' | 'fiscal'> {
  return {
    id: row.id,
    codigo: row.codigo,
    createdAt: row.createdAt.toISOString(),
    nome: row.nome,
    quantidade: Number(row.quantidade),
    medidaBase: row.medidaBase as ProductEntity['medidaBase'],
    codigoBarras: row.codigoBarras,
    marca: row.marca,
    embalagem: row.embalagem as ProductEntity['embalagem'],
    cDe: row.cDe as ProductEntity['cDe'],
    qtCad: row.qtCad,
    medidaCompra: row.medidaCompra as ProductEntity['medidaCompra'],
    codigoInterno: row.codigoInterno,
    fotoUrl: row.fotoUrl,
    grupo: row.grupo,
    tipo: row.tipo as ProductEntity['tipo'],
    status: row.status as ProductEntity['status'],
    habilitarAjuda: row.habilitarAjuda,
  };
}

function mapPromocao(row: typeof promocoes.$inferSelect): Promocao {
  return {
    id: row.id,
    tipo: row.tipo as Promocao['tipo'],
    valor: num(row.valor),
    descontoPct: num(row.descontoPct),
    horaInicio: row.horaInicio,
    horaFim: row.horaFim,
    dias: [row.seg, row.ter, row.qua, row.qui, row.sex, row.sab, row.dom],
    descontoAte: row.descontoAte,
  };
}

function mapLoja(row: typeof productLojas.$inferSelect, promos: Promocao[] = []): LojaComercial {
  return {
    loja: row.loja as LojaComercial['loja'],
    estoqueMin: num(row.estoqueMin),
    estoqueMax: num(row.estoqueMax),
    setorEstoque: row.setorEstoque,
    custo: num(row.custo),
    margemPontual: num(row.margemPontual),
    vVendaPontual: num(row.vVendaPontual),
    auto: row.auto,
    localVenda1: row.localVenda1,
    localVenda2: row.localVenda2,
    promocoes: promos,
  };
}

function mapTransformacao(row: typeof productTransformacao.$inferSelect): ProductEntity['transformacao'] {
  return {
    precisao: row.precisao as NonNullable<ProductEntity['transformacao']>['precisao'],
    qtd: Number(row.qtd),
    unidade: row.unidade as NonNullable<ProductEntity['transformacao']>['unidade'],
    produtoReceituario: row.produtoReceituario,
    refReceituario: row.refReceituario,
  };
}

function mapFiscal(row: typeof productFiscal.$inferSelect): ProductEntity['fiscal'] {
  return {
    ncm: row.ncm,
    cest: row.cest,
    categoria: row.categoria,
    cstPisCofins: row.cstPisCofins,
    aliquotaCheia: num(row.aliquotaCheia),
    aliquotaFcp: num(row.aliquotaFcp),
    aliquotaPis: num(row.aliquotaPis),
    aliquotaCofins: num(row.aliquotaCofins),
    reducaoIcms: num(row.reducaoIcms),
    icms: num(row.icms),
  };
}

@injectable()
export class ProductRepository {
  /** Cria produto + relações em uma transação. `codigo` é gerado no service. */
  async create(
    payload: ProductRequests.CreateProductRequest,
    codigo: string,
  ): Promise<ProductEntity> {
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(products)
        .values({
          codigo,
          nome: payload.nome,
          quantidade: toDb(payload.quantidade) ?? '0',
          medidaBase: payload.medidaBase,
          codigoBarras: payload.codigoBarras,
          marca: payload.marca,
          embalagem: payload.embalagem,
          cDe: payload.cDe,
          qtCad: payload.qtCad,
          medidaCompra: payload.medidaCompra,
          codigoInterno: payload.codigoInterno,
          fotoUrl: payload.fotoUrl,
          grupo: payload.grupo,
          tipo: payload.tipo,
          status: payload.status,
          habilitarAjuda: payload.habilitarAjuda,
        })
        .returning();
      if (!created) throw new Error('Falha ao criar produto');

      await this.replaceRelations(created.id, payload, tx);
      const full = await this.findById(created.id, tx);
      if (!full) throw new Error('Falha ao montar produto criado');
      return full;
    });
  }

  /** Atualiza por substituição (campos + relações), em transação. */
  async update(
    id: string,
    payload: ProductRequests.UpdateProductRequest,
  ): Promise<ProductEntity | null> {
    return db.transaction(async (tx) => {
      const exists = await tx.select({ id: products.id }).from(products).where(eq(products.id, id)).limit(1);
      if (exists.length === 0) return null;

      await tx
        .update(products)
        .set({
          ...(payload.nome !== undefined && { nome: payload.nome }),
          ...(payload.quantidade !== undefined && { quantidade: toDb(payload.quantidade) ?? '0' }),
          ...(payload.medidaBase !== undefined && { medidaBase: payload.medidaBase }),
          ...(payload.codigoBarras !== undefined && { codigoBarras: payload.codigoBarras }),
          ...(payload.marca !== undefined && { marca: payload.marca }),
          ...(payload.embalagem !== undefined && { embalagem: payload.embalagem }),
          ...(payload.cDe !== undefined && { cDe: payload.cDe }),
          ...(payload.qtCad !== undefined && { qtCad: payload.qtCad }),
          ...(payload.medidaCompra !== undefined && { medidaCompra: payload.medidaCompra }),
          ...(payload.codigoInterno !== undefined && { codigoInterno: payload.codigoInterno }),
          ...(payload.fotoUrl !== undefined && { fotoUrl: payload.fotoUrl }),
          ...(payload.grupo !== undefined && { grupo: payload.grupo }),
          ...(payload.tipo !== undefined && { tipo: payload.tipo }),
          ...(payload.status !== undefined && { status: payload.status }),
          ...(payload.habilitarAjuda !== undefined && { habilitarAjuda: payload.habilitarAjuda }),
        })
        .where(eq(products.id, id));

      await this.replaceRelations(id, payload, tx);
      return this.findById(id, tx);
    });
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await db.delete(products).where(eq(products.id, id)).returning({ id: products.id });
    return deleted.length > 0;
  }

  async findById(id: string, tx: Tx = db): Promise<ProductEntity | null> {
    const [prod] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
    if (!prod) return null;

    const [lojas, [transf], [fisc]] = await Promise.all([
      tx.select().from(productLojas).where(eq(productLojas.productId, id)),
      tx.select().from(productTransformacao).where(eq(productTransformacao.productId, id)).limit(1),
      tx.select().from(productFiscal).where(eq(productFiscal.productId, id)).limit(1),
    ]);

    const lojaIds = lojas.map((l) => l.id);
    const promos = lojaIds.length
      ? await tx.select().from(promocoes).where(inArray(promocoes.productLojaId, lojaIds))
      : [];
    const promosByLoja = new Map<string, Promocao[]>();
    for (const pr of promos) {
      const arr = promosByLoja.get(pr.productLojaId) ?? [];
      arr.push(mapPromocao(pr));
      promosByLoja.set(pr.productLojaId, arr);
    }

    return {
      ...mapProduct(prod),
      lojas: lojas.map((l) => mapLoja(l, promosByLoja.get(l.id) ?? [])),
      transformacao: transf ? mapTransformacao(transf) : null,
      fiscal: fisc ? mapFiscal(fisc) : null,
    };
  }

  async findByCodigo(codigo: string, tx: Tx = db): Promise<{ id: string } | null> {
    const [row] = await tx.select({ id: products.id }).from(products).where(eq(products.codigo, codigo)).limit(1);
    return row ?? null;
  }

  async list(filter: ProductRequests.ListProductQuery): Promise<ProductEntity[]> {
    const conditions = [];
    if (filter.tipo) conditions.push(eq(products.tipo, filter.tipo));
    if (filter.status) conditions.push(eq(products.status, filter.status));
    if (filter.q) {
      const term = `%${filter.q}%`;
      conditions.push(or(ilike(products.nome, term), ilike(products.marca, term), ilike(products.codigo, term)));
    }

    const rows = await db
      .select()
      .from(products)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(products.createdAt));

    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    // carrega relações em lote (evita N+1)
    const [lojas, transfs, fiscais] = await Promise.all([
      db.select().from(productLojas).where(inArray(productLojas.productId, ids)),
      db.select().from(productTransformacao).where(inArray(productTransformacao.productId, ids)),
      db.select().from(productFiscal).where(inArray(productFiscal.productId, ids)),
    ]);

    const lojaIds = lojas.map((l) => l.id);
    const promos = lojaIds.length
      ? await db.select().from(promocoes).where(inArray(promocoes.productLojaId, lojaIds))
      : [];
    const promosByLoja = new Map<string, Promocao[]>();
    for (const pr of promos) {
      const arr = promosByLoja.get(pr.productLojaId) ?? [];
      arr.push(mapPromocao(pr));
      promosByLoja.set(pr.productLojaId, arr);
    }

    const lojasByProduct = new Map<string, LojaComercial[]>();
    for (const l of lojas) {
      const arr = lojasByProduct.get(l.productId) ?? [];
      arr.push(mapLoja(l, promosByLoja.get(l.id) ?? []));
      lojasByProduct.set(l.productId, arr);
    }
    const transfByProduct = new Map(transfs.map((t) => [t.productId, mapTransformacao(t)]));
    const fiscalByProduct = new Map(fiscais.map((f) => [f.productId, mapFiscal(f)]));

    let result: ProductEntity[] = rows.map((r) => ({
      ...mapProduct(r),
      lojas: lojasByProduct.get(r.id) ?? [],
      transformacao: transfByProduct.get(r.id) ?? null,
      fiscal: fiscalByProduct.get(r.id) ?? null,
    }));

    if (filter.loja) result = result.filter((p) => p.lojas.some((l) => l.loja === filter.loja));
    return result;
  }

  // ---- relações (substituição completa) ----
  private async replaceRelations(
    productId: string,
    payload: ProductRequests.CreateProductRequest | ProductRequests.UpdateProductRequest,
    tx: Tx,
  ): Promise<void> {
    if (payload.lojas !== undefined) {
      // remove lojas (cascade apaga as promoções via FK)
      await tx.delete(productLojas).where(eq(productLojas.productId, productId));
      for (const l of payload.lojas) {
        const [lojaRow] = await tx
          .insert(productLojas)
          .values({
            productId,
            loja: l.loja,
            estoqueMin: toDb(l.estoqueMin),
            estoqueMax: toDb(l.estoqueMax),
            setorEstoque: l.setorEstoque,
            custo: toDb(l.custo),
            margemPontual: toDb(l.margemPontual),
            vVendaPontual: toDb(l.vVendaPontual),
            auto: l.auto,
            localVenda1: l.localVenda1,
            localVenda2: l.localVenda2,
          })
          .returning({ id: productLojas.id });

        if (lojaRow && l.promocoes?.length) {
          await tx.insert(promocoes).values(
            l.promocoes.map((p) => ({
              productLojaId: lojaRow.id,
              tipo: p.tipo,
              valor: toDb(p.valor ?? null),
              descontoPct: toDb(p.descontoPct ?? null),
              horaInicio: p.horaInicio ?? null,
              horaFim: p.horaFim ?? null,
              seg: p.dias?.[0] ?? false,
              ter: p.dias?.[1] ?? false,
              qua: p.dias?.[2] ?? false,
              qui: p.dias?.[3] ?? false,
              sex: p.dias?.[4] ?? false,
              sab: p.dias?.[5] ?? false,
              dom: p.dias?.[6] ?? false,
              descontoAte: p.descontoAte ?? null,
            })),
          );
        }
      }
    }

    if (payload.transformacao !== undefined) {
      await tx.delete(productTransformacao).where(eq(productTransformacao.productId, productId));
      if (payload.transformacao) {
        const t = payload.transformacao;
        await tx.insert(productTransformacao).values({
          productId,
          precisao: t.precisao,
          qtd: toDb(t.qtd),
          unidade: t.unidade,
          produtoReceituario: t.produtoReceituario,
          refReceituario: t.refReceituario,
        });
      }
    }

    if (payload.fiscal !== undefined) {
      await tx.delete(productFiscal).where(eq(productFiscal.productId, productId));
      if (payload.fiscal) {
        const f = payload.fiscal;
        await tx.insert(productFiscal).values({
          productId,
          ncm: f.ncm,
          cest: f.cest,
          categoria: f.categoria,
          cstPisCofins: f.cstPisCofins,
          aliquotaCheia: toDb(f.aliquotaCheia),
          aliquotaFcp: toDb(f.aliquotaFcp),
          aliquotaPis: toDb(f.aliquotaPis),
          aliquotaCofins: toDb(f.aliquotaCofins),
          reducaoIcms: toDb(f.reducaoIcms),
          icms: toDb(f.icms),
        });
      }
    }
  }
}
