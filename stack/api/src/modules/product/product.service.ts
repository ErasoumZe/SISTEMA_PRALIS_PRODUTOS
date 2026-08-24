import { inject, injectable } from 'tsyringe';
import { customAlphabet } from 'nanoid';
import { ProductRequests, ProductSchemas } from '@pralis/shared';
import { ProductRepository } from './product.repository';
import { ProductSheetService, type SheetSyncOutcome } from '@/modules/google-sheets/product-sheet.service';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { TaxRuleService, type FiscalClassification } from '@/modules/apoio/tax-rule.service';

const rand4 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', 4);
const genCodigo = () => `PR-${rand4()}-${rand4()}`;

/** Produto criado + como ficou o espelhamento na planilha (nunca bloqueia o cadastro). */
export type CreatedProduct = ProductSchemas.ProductEntity & { sheetSync: SheetSyncOutcome };

@injectable()
export class ProductService {
  constructor(
    @inject(ProductRepository) private repo: ProductRepository,
    @inject(ProductSheetService) private sheets: ProductSheetService,
    @inject(TaxRuleService) private taxRules: TaxRuleService,
  ) {}

  private withAutomaticTax<T extends ProductRequests.CreateProductRequest | ProductRequests.UpdateProductRequest>(
    payload: T,
    rule: FiscalClassification,
  ): T {
    const fiscal = payload.fiscal ?? {
      ncm: null, cest: null, categoria: null, cstPisCofins: null,
      aliquotaCheia: null, aliquotaFcp: null, aliquotaPis: null,
      aliquotaCofins: null, reducaoIcms: null, icms: null,
    };
    return {
      ...payload,
      grupo: rule.grupo,
      fiscal: {
        ...fiscal,
        ncm: rule.ncm ?? fiscal.ncm,
        cstPisCofins: rule.cstPisCofins,
        tributacaoSimples: rule.tributacaoSimples,
        aliquotaSimples: rule.aliquotaSimples,
        icmsRe: rule.icmsRe,
        baseFiscal: rule.baseFiscal,
        codigoFiscal: rule.codigoFiscal,
        produtoFiscal: rule.produtoFiscal,
        cstReforma: rule.cstReforma,
        cClassTrib: rule.cClassTrib,
        aliquotaIbs: rule.aliquotaIbs,
        aliquotaCbs: rule.aliquotaCbs,
        origemFiscal: rule.origem,
      },
    } as T;
  }

  private async novoCodigo(): Promise<string> {
    let codigo = genCodigo();
    for (let i = 0; i < 5 && (await this.repo.findByCodigo(codigo)); i++) codigo = genCodigo();
    return codigo;
  }

  async create(user: CurrentUser, payload: ProductRequests.CreateProductRequest): Promise<CreatedProduct> {
    // Governança: produto NOVO só o admin cria, e sempre na base geral.
    // As lojas recebem produtos por importação (importFromBase), nunca por cadastro direto.
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador cadastra produtos novos (na base geral).', 403, 'ONLY_ADMIN_CREATE');
    }
    const alvo = 'BASE' as const;
    if (!payload.grupo?.trim()) {
      throw new AppError('Selecione o grupo de mercadorias para aplicar a regra fiscal.', 422, 'GROUP_REQUIRED');
    }
    const payloadComImposto = this.withAutomaticTax(
      payload,
      await this.taxRules.classify(payload.grupo, payload.codigoBarras ?? undefined),
    );

    if (!payloadComImposto.forcar) {
      const dup = await this.repo.findDuplicate(alvo, payloadComImposto.nome, payloadComImposto.codigoBarras ?? null);
      if (dup) {
        throw new AppError(
          `Produto "${dup.nome}" já cadastrado${dup.createdByName ? ` por ${dup.createdByName}` : ''}.`,
          409,
          'DUPLICATE_PRODUCT',
        );
      }
    }
    const codigo = await this.novoCodigo();
    const codigoInterno = await this.repo.proximoCodigoInterno();

    // produto + registro `pending` de espelhamento na MESMA transação
    const created = await this.repo.create(
      payloadComImposto,
      { loja: alvo, codigo, codigoInterno, createdByUserId: user.id, createdByName: user.name },
      (productId, tx) => this.sheets.registerPending(productId, tx),
    );

    // Depois do commit: tenta espelhar. O produto JÁ está salvo — se o Google
    // falhar, o registro fica `failed` e o usuário vê "sincronização pendente",
    // nunca um erro que o faça cadastrar de novo.
    const sync = await this.sheets.syncProduct(created.id).catch(() => ({ outcome: 'failed' as const }));
    return { ...created, sheetSync: sync.outcome };
  }

  async list(user: CurrentUser, filter: ProductRequests.ListProductQuery) {
    // admin pode visualizar qualquer catálogo (BASE/TNP/LI/HORA); usuário comum só a própria loja
    const alvo = filter.loja && user.role === 'admin' ? filter.loja : user.loja ?? 'BASE';
    return this.repo.list(alvo, filter);
  }

  /** Catálogo base; marca `importado` conforme já está na loja do usuário (tela de importar). */
  async listBase(user: CurrentUser, filter: ProductRequests.ListProductQuery) {
    return this.repo.list('BASE', filter, user.loja);
  }

  async getById(user: CurrentUser, id: string): Promise<ProductSchemas.ProductEntity> {
    const p = await this.repo.findById(id);
    if (!p) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
    if (p.loja !== user.loja && p.loja !== 'BASE' && user.role !== 'admin') {
      throw new AppError('Produto não pertence à sua loja', 403, 'FORBIDDEN');
    }
    return p;
  }

  async update(user: CurrentUser, id: string, payload: ProductRequests.UpdateProductRequest) {
    // editar: admin (qualquer produto) ou colaborador (produtos da própria loja)
    const p = await this.repo.findById(id);
    if (!p) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
    if (user.role !== 'admin' && p.loja !== user.loja) {
      throw new AppError('Você só pode editar produtos da sua loja.', 403, 'FORBIDDEN');
    }
    let payloadFinal = payload;
    const grupoEfetivo = payload.grupo ?? p.grupo;
    if (payload.grupo !== undefined || payload.codigoBarras !== undefined || payload.fiscal !== undefined) {
      if (!grupoEfetivo?.trim()) {
        throw new AppError('Selecione o grupo de mercadorias para aplicar a regra fiscal.', 422, 'GROUP_REQUIRED');
      }
      // Alterar somente o grupo não pode apagar NCM/CEST e demais dados
      // específicos já existentes no produto.
      const comFiscalAnterior = payload.fiscal === undefined ? { ...payload, fiscal: p.fiscal } : payload;
      const codigoBarrasEfetivo = payload.codigoBarras ?? p.codigoBarras ?? undefined;
      payloadFinal = this.withAutomaticTax(
        comFiscalAnterior,
        await this.taxRules.classify(grupoEfetivo, codigoBarrasEfetivo),
      );
    }
    const updated = await this.repo.update(id, payloadFinal);
    if (!updated) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
    if (updated.loja === 'BASE') {
      await this.sheets.registerPending(updated.id);
      await this.sheets.syncProduct(updated.id).catch(() => undefined);
    }
    return updated;
  }

  async delete(user: CurrentUser, id: string) {
    // excluir é exclusivo do admin
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador exclui produtos.', 403, 'ONLY_ADMIN_DELETE');
    }
    const p = await this.repo.findById(id);
    if (!p) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
    const ok = await this.repo.delete(id);
    if (!ok) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
  }

  /** Importa produtos da BASE para a loja do usuário (pula os já importados/duplicados). */
  async importFromBase(user: CurrentUser, baseIds: string[]): Promise<{ imported: number; skipped: number }> {
    // importação é da BASE para a loja do usuário; admin (sem loja) não usa este fluxo
    const loja = user.loja;
    if (!loja) throw new AppError('Apenas usuários de loja podem importar da base', 400, 'NO_LOJA');
    let imported = 0;
    let skipped = 0;
    for (const baseId of baseIds) {
      const base = await this.repo.findById(baseId);
      if (!base || base.loja !== 'BASE') { skipped++; continue; }
      if (await this.repo.existsByBase(loja, baseId)) { skipped++; continue; }
      if (await this.repo.findDuplicate(loja, base.nome, base.codigoBarras ?? null)) { skipped++; continue; }
      const codigo = await this.novoCodigo();
      await this.repo.create(this.toCreatePayload(base), {
        loja,
        codigo,
        codigoInterno: base.codigoInterno, // herda o mesmo código interno da base (igual entre lojas)
        createdByUserId: user.id,
        createdByName: user.name,
        baseProductId: baseId,
      });
      imported++;
    }
    return { imported, skipped };
  }

  private toCreatePayload(p: ProductSchemas.ProductEntity): ProductRequests.CreateProductRequest {
    return {
      nome: p.nome, quantidade: p.quantidade, medidaBase: p.medidaBase, codigoBarras: p.codigoBarras,
      marca: p.marca, embalagem: p.embalagem, cDe: p.cDe, qtCad: p.qtCad, medidaCompra: p.medidaCompra,
      codigoInterno: p.codigoInterno, fotoUrl: p.fotoUrl, grupo: p.grupo, tipo: p.tipo, status: p.status,
      habilitarAjuda: p.habilitarAjuda, estoqueMin: p.estoqueMin, estoqueMax: p.estoqueMax,
      setorEstoque: p.setorEstoque, custo: p.custo, margemPontual: p.margemPontual,
      vVendaPontual: p.vVendaPontual, auto: p.auto, localVenda1: p.localVenda1, localVenda2: p.localVenda2,
      promocoes: p.promocoes, transformacao: p.transformacao, fiscal: p.fiscal,
    };
  }
}
