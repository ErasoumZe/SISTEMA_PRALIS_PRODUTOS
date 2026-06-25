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
    // Governança: produto NOVO só o admin cria, e sempre na base geral.
    // As lojas recebem produtos por importação (importFromBase), nunca por cadastro direto.
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador cadastra produtos novos (na base geral).', 403, 'ONLY_ADMIN_CREATE');
    }
    const alvo = 'BASE' as const;

    if (!payload.forcar) {
      const dup = await this.repo.findDuplicate(alvo, payload.nome, payload.codigoBarras ?? null);
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
    return this.repo.create(payload, {
      loja: alvo,
      codigo,
      codigoInterno,
      createdByUserId: user.id,
      createdByName: user.name,
    });
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
    const updated = await this.repo.update(id, payload);
    if (!updated) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
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
