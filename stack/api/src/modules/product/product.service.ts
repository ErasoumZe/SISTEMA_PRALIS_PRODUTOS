import { inject, injectable } from 'tsyringe';
import { customAlphabet } from 'nanoid';
import { ProductRequests, ProductSchemas } from '@pralis/shared';
import { ProductRepository } from './product.repository';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';

const rand4 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', 4);
const genCodigo = () => `PR-${rand4()}-${rand4()}`;

@injectable()
export class ProductService {
  constructor(@inject(ProductRepository) private repo: ProductRepository) {}

  private async novoCodigo(): Promise<string> {
    let codigo = genCodigo();
    for (let i = 0; i < 5 && (await this.repo.findByCodigo(codigo)); i++) codigo = genCodigo();
    return codigo;
  }

  async create(user: CurrentUser, payload: ProductRequests.CreateProductRequest): Promise<ProductSchemas.ProductEntity> {
    if (!payload.forcar) {
      const dup = await this.repo.findDuplicate(user.loja, payload.nome, payload.codigoBarras ?? null);
      if (dup) {
        throw new AppError(
          `Produto "${dup.nome}" já cadastrado${dup.createdByName ? ` por ${dup.createdByName}` : ''}.`,
          409,
          'DUPLICATE_PRODUCT',
        );
      }
    }
    const codigo = await this.novoCodigo();
    return this.repo.create(payload, {
      loja: user.loja,
      codigo,
      createdByUserId: user.id,
      createdByName: user.name,
    });
  }

  async list(user: CurrentUser, filter: ProductRequests.ListProductQuery) {
    return this.repo.list(user.loja, filter);
  }

  async listBase(filter: ProductRequests.ListProductQuery) {
    return this.repo.list('BASE', filter);
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
    await this.assertOwnership(user, id);
    const updated = await this.repo.update(id, payload);
    if (!updated) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
    return updated;
  }

  async delete(user: CurrentUser, id: string) {
    await this.assertOwnership(user, id);
    const ok = await this.repo.delete(id);
    if (!ok) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
  }

  /** Importa produtos da BASE para a loja do usuário (pula os já importados/duplicados). */
  async importFromBase(user: CurrentUser, baseIds: string[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;
    for (const baseId of baseIds) {
      const base = await this.repo.findById(baseId);
      if (!base || base.loja !== 'BASE') { skipped++; continue; }
      if (await this.repo.existsByBase(user.loja, baseId)) { skipped++; continue; }
      if (await this.repo.findDuplicate(user.loja, base.nome, base.codigoBarras ?? null)) { skipped++; continue; }
      const codigo = await this.novoCodigo();
      await this.repo.create(this.toCreatePayload(base), {
        loja: user.loja,
        codigo,
        createdByUserId: user.id,
        createdByName: user.name,
        baseProductId: baseId,
      });
      imported++;
    }
    return { imported, skipped };
  }

  private async assertOwnership(user: CurrentUser, id: string) {
    const p = await this.repo.findById(id);
    if (!p) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
    if (p.loja !== user.loja && user.role !== 'admin') {
      throw new AppError('Você só pode alterar produtos da sua loja', 403, 'FORBIDDEN');
    }
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
