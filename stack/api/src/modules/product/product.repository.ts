import { injectable } from 'tsyringe';
import { and, eq, ilike, inArray, or, desc, isNotNull, sql, ne } from 'drizzle-orm';
import { db, Tx } from '@/db/databases';
import { barcodeCandidates } from '@/modules/apoio/tax-rule.service';
import { ProductSchemas, ProductRequests } from '@pralis/shared';
import { products, productTransformacao, productFiscal, promocoes } from './product.table';
import { calcularProximoCodigoInterno } from './codigo-interno';

type ProductEntity = ProductSchemas.ProductEntity;
type Promocao = ProductSchemas.Promocao;
type Catalogo = 'BASE' | 'TNP' | 'LI' | 'HORA';

export interface CreateContext {
  loja: Catalogo;
  codigo: string;
  createdByUserId: string | null;
  createdByName: string | null;
  baseProductId?: string | null;
  /**
   * Código interno (00001...), igual entre BASE e as cópias das lojas.
   *
   * `undefined` = **gere um**, dentro da transação da criação.
   * `null` ou string = use exatamente isto.
   */
  codigoInterno?: string | null;
}

/**
 * Chave da trava de aviso da geração de código interno. Número arbitrário e
 * fixo: o que importa é ser o MESMO em todas as conexões, e não colidir com
 * outra trava do sistema.
 */
const CHAVE_TRAVA_CODIGO_INTERNO = 811_042_001;

// ---- helpers de conversão ----
const num = (v: string | null): number | null => (v == null ? null : Number(v));
const toDb = (n: number | null | undefined): string | null => (n == null ? null : String(n));

function mapPromocao(r: typeof promocoes.$inferSelect): Promocao {
  return {
    id: r.id,
    tipo: r.tipo as Promocao['tipo'],
    valor: num(r.valor),
    descontoPct: num(r.descontoPct),
    horaInicio: r.horaInicio,
    horaFim: r.horaFim,
    dias: [r.seg, r.ter, r.qua, r.qui, r.sex, r.sab, r.dom],
    descontoAte: r.descontoAte,
  };
}

function mapProduct(row: typeof products.$inferSelect): Omit<ProductEntity, 'promocoes' | 'transformacao' | 'fiscal'> {
  return {
    id: row.id,
    codigo: row.codigo,
    loja: row.loja as ProductEntity['loja'],
    baseProductId: row.baseProductId,
    createdByName: row.createdByName,
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
    compraAproximada: row.compraAproximada ?? false,
    codigoInterno: row.codigoInterno,
    fotoUrl: row.fotoUrl,
    grupo: row.grupo,
    tipo: row.tipo as ProductEntity['tipo'],
    status: row.status as ProductEntity['status'],
    habilitarAjuda: row.habilitarAjuda,
    estoqueMin: num(row.estoqueMin),
    estoqueMax: num(row.estoqueMax),
    setorEstoque: row.setorEstoque,
    custo: num(row.custo),
    margemPontual: num(row.margemPontual),
    vVendaPontual: num(row.vVendaPontual),
    auto: row.auto,
    setorVenda1: row.setorVenda1,
    setorVenda2: row.setorVenda2,
    localVenda1: row.localVenda1,
    localVenda2: row.localVenda2,
  };
}

function mapTransformacao(r: typeof productTransformacao.$inferSelect): ProductEntity['transformacao'] {
  return {
    precisao: r.precisao as NonNullable<ProductEntity['transformacao']>['precisao'],
    qtd: Number(r.qtd),
    unidade: r.unidade as NonNullable<ProductEntity['transformacao']>['unidade'],
    produtoReceituario: r.produtoReceituario,
    refReceituario: r.refReceituario,
  };
}

function mapFiscal(r: typeof productFiscal.$inferSelect): ProductEntity['fiscal'] {
  return {
    ncm: r.ncm, cest: r.cest, categoria: r.categoria, cstPisCofins: r.cstPisCofins,
    aliquotaCheia: num(r.aliquotaCheia), aliquotaFcp: num(r.aliquotaFcp),
    aliquotaPis: num(r.aliquotaPis), aliquotaCofins: num(r.aliquotaCofins),
    reducaoIcms: num(r.reducaoIcms), icms: num(r.icms),
    tributacaoSimples: r.tributacaoSimples, aliquotaSimples: num(r.aliquotaSimples),
    icmsRe: num(r.icmsRe), baseFiscal: r.baseFiscal,
    codigoFiscal: r.codigoFiscal, produtoFiscal: r.produtoFiscal,
    cstReforma: r.cstReforma, cClassTrib: r.cClassTrib,
    aliquotaIbs: num(r.aliquotaIbs), aliquotaCbs: num(r.aliquotaCbs),
    origemFiscal: r.origemFiscal as ProductEntity['fiscal'] extends infer F
      ? F extends { origemFiscal: infer O } ? O : never : never,
    aliquotaEcf: r.aliquotaEcf,
    aliquotaEcfId: r.aliquotaEcfId,
    estado: r.estado,
    motivo: r.motivo,
    pctNcm: num(r.pctNcm),
  };
}

type ProductInput = ProductRequests.CreateProductRequest | ProductRequests.UpdateProductRequest;

@injectable()
export class ProductRepository {
  /**
   * `onCreated` roda DENTRO da mesma transação do produto — é assim que o
   * registro `pending` de espelhamento nasce junto com o produto (tudo ou nada).
   * O repositório continua sem saber o que é Google: recebe só um callback.
   */
  async create(
    payload: ProductRequests.CreateProductRequest,
    ctx: CreateContext,
    onCreated?: (productId: string, tx: Tx) => Promise<void>,
  ): Promise<ProductEntity> {
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(products)
        .values({
          loja: ctx.loja,
          codigo: ctx.codigo,
          baseProductId: ctx.baseProductId ?? null,
          createdByUserId: ctx.createdByUserId,
          createdByName: ctx.createdByName,
          ...this.productColumns(payload),
          // `undefined` pede geração aqui dentro — a trava só vale enquanto a
          // transação existe, então gerar fora dela não protegeria de nada.
          codigoInterno: ctx.codigoInterno === undefined
            ? await this.proximoCodigoInterno(ctx.loja, tx)
            : ctx.codigoInterno,
        } as typeof products.$inferInsert)
        .returning();
      if (!created) throw new Error('Falha ao criar produto');
      await this.replaceRelations(created.id, payload, tx);
      if (onCreated) await onCreated(created.id, tx);
      const full = await this.findById(created.id, tx);
      if (!full) throw new Error('Falha ao montar produto criado');
      return full;
    });
  }

  async update(id: string, payload: ProductRequests.UpdateProductRequest): Promise<ProductEntity | null> {
    return db.transaction(async (tx) => {
      const exists = await tx.select({ id: products.id }).from(products).where(eq(products.id, id)).limit(1);
      if (exists.length === 0) return null;
      // Um payload que só mexe em relações (promoções, fiscal, transformação)
      // não tem coluna nenhuma para atualizar, e `set({})` faz o drizzle
      // estourar "No values to set". As relações abaixo continuam valendo.
      const colunas = this.productColumns(payload);
      if (Object.keys(colunas).length > 0) {
        await tx.update(products).set(colunas as Partial<typeof products.$inferInsert>).where(eq(products.id, id));
      }
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
    const [promos, [transf], [fisc]] = await Promise.all([
      tx.select().from(promocoes).where(eq(promocoes.productId, id)),
      tx.select().from(productTransformacao).where(eq(productTransformacao.productId, id)).limit(1),
      tx.select().from(productFiscal).where(eq(productFiscal.productId, id)).limit(1),
    ]);
    return {
      ...mapProduct(prod),
      promocoes: promos.map(mapPromocao),
      transformacao: transf ? mapTransformacao(transf) : null,
      fiscal: fisc ? mapFiscal(fisc) : null,
    };
  }

  async findByCodigo(codigo: string, tx: Tx = db): Promise<{ id: string } | null> {
    const [row] = await tx.select({ id: products.id }).from(products).where(eq(products.codigo, codigo)).limit(1);
    return row ?? null;
  }

  /** Próximo código interno sequencial, acima do maior do sistema e da faixa legada do Criare. */
  /**
   * Próximo código interno livre.
   *
   * `MAX + 1` sozinho não é seguro: dois cadastros simultâneos leem o mesmo
   * máximo e recebem o mesmo número — e é por esse código que o SIA casa o
   * produto. A trava de aviso do Postgres serializa só esta geração, e é
   * liberada no fim da transação; não bloqueia nada além disso.
   *
   * Trava de aviso em vez de sequence porque não exige mudança de schema: o
   * `start:prod` ainda roda `drizzle-kit push --force`, e trocar isso é
   * assunto separado.
   */
  async proximoCodigoInterno(loja: Catalogo = 'BASE', tx: Tx = db): Promise<string> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CHAVE_TRAVA_CODIGO_INTERNO})`);
    const res = await tx.execute(
      sql`SELECT COALESCE(MAX(CAST(codigo_interno AS INTEGER)), 0) AS max
          FROM products
          WHERE loja = ${loja} AND codigo_interno ~ '^[0-9]+$'`,
    );
    const max = Number((res.rows?.[0] as { max?: number | string } | undefined)?.max ?? 0);
    return calcularProximoCodigoInterno(max, loja);
  }

  /** Produto duplicado dentro da loja: mesmo nome (case-insensitive) OU mesmo código de barras. */
  async findDuplicate(
    loja: Catalogo,
    nome: string,
    codigoBarras: string | null,
    ignoreId?: string,
  ): Promise<{ id: string; nome: string; createdByName: string | null } | null> {
    const orParts = [ilike(products.nome, nome)];
    if (codigoBarras) orParts.push(eq(products.codigoBarras, codigoBarras));
    const rows = await db
      .select({ id: products.id, nome: products.nome, createdByName: products.createdByName })
      .from(products)
      .where(and(eq(products.loja, loja), or(...orParts)));
    const found = rows.find((r) => r.id !== ignoreId);
    return found ?? null;
  }

  async existsByBase(loja: Catalogo, baseProductId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.loja, loja), eq(products.baseProductId, baseProductId)))
      .limit(1);
    return !!row;
  }

  /** Cópias deste produto da BASE nas lojas (criadas por `importFromBase`). */
  async listByBaseProductId(baseProductId: string): Promise<ProductEntity[]> {
    const linhas = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.baseProductId, baseProductId));
    const completos = await Promise.all(linhas.map((l) => this.findById(l.id)));
    return completos.filter((p): p is ProductEntity => p !== null);
  }

  async list(
    loja: Catalogo,
    filter: ProductRequests.ListProductQuery,
    importadosNaLoja?: Catalogo | null,
  ): Promise<ProductEntity[]> {
    // Cadastro aposentado por unificação some das listagens — continua no
    // banco para o desfazer, mas não é mais um produto.
    const conditions = [eq(products.loja, loja), ne(products.status, 'unificado')];
    if (filter.tipo) conditions.push(eq(products.tipo, filter.tipo));
    if (filter.status) conditions.push(eq(products.status, filter.status));
    if (filter.q) {
      const term = `%${filter.q}%`;
      conditions.push(or(ilike(products.nome, term), ilike(products.marca, term), ilike(products.codigo, term))!);
    }
    /*
     * Igualdade, não `ilike`: código de barras não é texto de busca, é
     * identidade. Compara pelas MESMAS variantes que o fiscal e as vendas usam
     * (`barcodeCandidates` tira zeros à esquerda e resolve EAN de balança),
     * senão "0000789" e "789" pareceriam produtos diferentes.
     */
    if (filter.codigoBarras) {
      const variantes = barcodeCandidates(filter.codigoBarras);
      conditions.push(
        variantes.length > 1
          ? inArray(products.codigoBarras, variantes)
          : eq(products.codigoBarras, variantes[0] ?? filter.codigoBarras),
      );
    }

    /*
     * "Já vendeu" tem duas provas, e a segunda existe porque a primeira não
     * alcança tudo:
     *  - o código do PDV bate com o código de barras (é assim que 93% casam,
     *    medido em 09/09/2026 sobre 1.959 produtos vendidos);
     *  - ou alguém confirmou o de-para à mão, que é o caminho para o produto
     *    vendido a granel, sem código nenhum.
     * Zeros à esquerda são ignorados nos dois lados, como no resto do sistema.
     */
    if (filter.somenteVendidos) {
      conditions.push(sql`(
        EXISTS (
          SELECT 1 FROM venda_produto_dia v
          WHERE v.loja = ${products.loja}
            AND ltrim(v.produto_codigo, '0') <> ''
            AND ltrim(v.produto_codigo, '0') = ltrim(coalesce(${products.codigoBarras}, ''), '0')
        )
        OR EXISTS (SELECT 1 FROM produto_creare pc WHERE pc.product_id = ${products.id})
      )`);
    }

    const rows = await db.select().from(products).where(and(...conditions)).orderBy(desc(products.createdAt));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const [promos, transfs, fiscais] = await Promise.all([
      db.select().from(promocoes).where(inArray(promocoes.productId, ids)),
      db.select().from(productTransformacao).where(inArray(productTransformacao.productId, ids)),
      db.select().from(productFiscal).where(inArray(productFiscal.productId, ids)),
    ]);

    const promosByProduct = new Map<string, Promocao[]>();
    for (const pr of promos) {
      const arr = promosByProduct.get(pr.productId) ?? [];
      arr.push(mapPromocao(pr));
      promosByProduct.set(pr.productId, arr);
    }
    const transfByProduct = new Map(transfs.map((t) => [t.productId, mapTransformacao(t)]));
    const fiscalByProduct = new Map(fiscais.map((f) => [f.productId, mapFiscal(f)]));

    // tela de importar: marca quais produtos da BASE já estão na loja do colaborador
    const marcarImportados = loja === 'BASE' && !!importadosNaLoja;
    let importados = new Set<string>();
    if (marcarImportados) {
      const refs = await db
        .selectDistinct({ baseProductId: products.baseProductId })
        .from(products)
        .where(and(eq(products.loja, importadosNaLoja as Catalogo), isNotNull(products.baseProductId)));
      importados = new Set(refs.map((r) => r.baseProductId).filter((x): x is string => !!x));
    }

    return rows.map((r) => ({
      ...mapProduct(r),
      promocoes: promosByProduct.get(r.id) ?? [],
      transformacao: transfByProduct.get(r.id) ?? null,
      fiscal: fiscalByProduct.get(r.id) ?? null,
      ...(marcarImportados ? { importado: importados.has(r.id) } : {}),
    }));
  }

  // ---- internos ----
  private productColumns(p: ProductInput) {
    const set: Record<string, unknown> = {};
    const assign = (k: string, v: unknown) => { if (v !== undefined) set[k] = v; };
    assign('nome', p.nome);
    assign('quantidade', p.quantidade !== undefined ? toDb(p.quantidade) ?? '0' : undefined);
    assign('medidaBase', p.medidaBase);
    assign('codigoBarras', p.codigoBarras);
    assign('marca', p.marca);
    assign('embalagem', p.embalagem);
    assign('cDe', p.cDe);
    assign('qtCad', p.qtCad);
    assign('medidaCompra', p.medidaCompra);
    assign('compraAproximada', p.compraAproximada);
    assign('codigoInterno', p.codigoInterno);
    assign('fotoUrl', p.fotoUrl);
    assign('grupo', p.grupo);
    assign('tipo', p.tipo);
    assign('status', p.status);
    assign('habilitarAjuda', p.habilitarAjuda);
    assign('estoqueMin', p.estoqueMin !== undefined ? toDb(p.estoqueMin) : undefined);
    assign('estoqueMax', p.estoqueMax !== undefined ? toDb(p.estoqueMax) : undefined);
    assign('setorEstoque', p.setorEstoque);
    assign('custo', p.custo !== undefined ? toDb(p.custo) : undefined);
    assign('margemPontual', p.margemPontual !== undefined ? toDb(p.margemPontual) : undefined);
    assign('vVendaPontual', p.vVendaPontual !== undefined ? toDb(p.vVendaPontual) : undefined);
    assign('auto', p.auto);
    assign('setorVenda1', p.setorVenda1);
    assign('setorVenda2', p.setorVenda2);
    assign('localVenda1', p.localVenda1);
    assign('localVenda2', p.localVenda2);
    return set;
  }

  private async replaceRelations(productId: string, payload: ProductInput, tx: Tx): Promise<void> {
    if (payload.transformacao !== undefined) {
      await tx.delete(productTransformacao).where(eq(productTransformacao.productId, productId));
      if (payload.transformacao) {
        const t = payload.transformacao;
        await tx.insert(productTransformacao).values({
          productId, precisao: t.precisao, qtd: toDb(t.qtd), unidade: t.unidade,
          produtoReceituario: t.produtoReceituario, refReceituario: t.refReceituario,
        });
      }
    }
    if (payload.fiscal !== undefined) {
      await tx.delete(productFiscal).where(eq(productFiscal.productId, productId));
      if (payload.fiscal) {
        const f = payload.fiscal;
        await tx.insert(productFiscal).values({
          productId, ncm: f.ncm, cest: f.cest, categoria: f.categoria, cstPisCofins: f.cstPisCofins,
          aliquotaCheia: toDb(f.aliquotaCheia), aliquotaFcp: toDb(f.aliquotaFcp),
          aliquotaPis: toDb(f.aliquotaPis), aliquotaCofins: toDb(f.aliquotaCofins),
          reducaoIcms: toDb(f.reducaoIcms), icms: toDb(f.icms),
          tributacaoSimples: f.tributacaoSimples, aliquotaSimples: toDb(f.aliquotaSimples),
          icmsRe: toDb(f.icmsRe), baseFiscal: f.baseFiscal,
          codigoFiscal: f.codigoFiscal, produtoFiscal: f.produtoFiscal,
          cstReforma: f.cstReforma, cClassTrib: f.cClassTrib,
          aliquotaIbs: toDb(f.aliquotaIbs), aliquotaCbs: toDb(f.aliquotaCbs),
          origemFiscal: f.origemFiscal,
          aliquotaEcf: f.aliquotaEcf,
          aliquotaEcfId: f.aliquotaEcfId,
          estado: f.estado,
          motivo: f.motivo,
          pctNcm: toDb(f.pctNcm),
          // Marca a TENTATIVA, não só o sucesso: é o que separa "nunca foi
          // classificado" de "foi, e não havia fonte".
          conferidoEm: f.estado ? new Date() : null,
        });
      }
    }
    if (payload.promocoes !== undefined) {
      await tx.delete(promocoes).where(eq(promocoes.productId, productId));
      if (payload.promocoes.length) {
        await tx.insert(promocoes).values(
          payload.promocoes.map((p) => ({
            productId, tipo: p.tipo, valor: toDb(p.valor ?? null), descontoPct: toDb(p.descontoPct ?? null),
            horaInicio: p.horaInicio ?? null, horaFim: p.horaFim ?? null,
            seg: p.dias?.[0] ?? false, ter: p.dias?.[1] ?? false, qua: p.dias?.[2] ?? false,
            qui: p.dias?.[3] ?? false, sex: p.dias?.[4] ?? false, sab: p.dias?.[5] ?? false, dom: p.dias?.[6] ?? false,
            descontoAte: p.descontoAte ?? null,
          })),
        );
      }
    }
  }
}
