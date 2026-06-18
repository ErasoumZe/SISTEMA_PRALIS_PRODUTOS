import { inject, injectable } from 'tsyringe';
import { customAlphabet } from 'nanoid';
import { ProductRequests, ProductSchemas } from '@pralis/shared';
import { ProductRepository } from './product.repository';
import { AppError } from '@/config/api.replies';

const rand4 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', 4);
const genCodigo = (): string => `PR-${rand4()}-${rand4()}`;

@injectable()
export class ProductService {
  constructor(@inject(ProductRepository) private repo: ProductRepository) {}

  async create(payload: ProductRequests.CreateProductRequest): Promise<ProductSchemas.ProductEntity> {
    let codigo = genCodigo();
    for (let i = 0; i < 5 && (await this.repo.findByCodigo(codigo)); i++) codigo = genCodigo();
    return this.repo.create(payload, codigo);
  }

  async getById(id: string): Promise<ProductSchemas.ProductEntity> {
    const product = await this.repo.findById(id);
    if (!product) throw new AppError('Produto não encontrado', 404, 'PRODUCT_NOT_FOUND');
    return product;
  }

  async list(filter: ProductRequests.ListProductQuery): Promise<ProductSchemas.ProductEntity[]> {
    return this.repo.list(filter);
  }

  async update(
    id: string,
    payload: ProductRequests.UpdateProductRequest,
  ): Promise<ProductSchemas.ProductEntity> {
    const updated = await this.repo.update(id, payload);
    if (!updated) throw new AppError('Produto não encontrado', 404, 'PRODUCT_NOT_FOUND');
    return updated;
  }

  async delete(id: string): Promise<void> {
    const ok = await this.repo.delete(id);
    if (!ok) throw new AppError('Produto não encontrado', 404, 'PRODUCT_NOT_FOUND');
  }
}
