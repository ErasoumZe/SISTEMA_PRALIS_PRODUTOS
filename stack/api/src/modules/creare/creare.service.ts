import { inject, injectable } from 'tsyringe';
import { Creare } from '@pralis/shared';
import { env } from '@/config/env';
import { AppError } from '@/config/api.replies';
import { ProductRepository } from '@/modules/product/product.repository';
import { parseCreareConfigs, type CreareStore } from './creare.config';

export interface CreareHealth {
  enabled: boolean;
  configOk: boolean;
  configErrors: string[];
  configuredStores: CreareStore[];
  approvedForProduction: false;
}

@injectable()
export class CreareService {
  constructor(@inject(ProductRepository) private products: ProductRepository) {}

  health(): CreareHealth {
    const parsed = parseCreareConfigs(env.CREARE_STORE_CONFIG_JSON);
    return {
      enabled: env.CREARE_EXPORT_ENABLED,
      configOk: parsed.errors.length === 0,
      configErrors: parsed.errors,
      configuredStores: (['TNP', 'LI', 'HORA'] as const).filter((store) => !!parsed.configs[store]),
      // Só muda depois da homologação formal; a feature flag não equivale a aprovação.
      approvedForProduction: false,
    };
  }

  async generate(store: CreareStore): Promise<Buffer> {
    if (!env.CREARE_EXPORT_ENABLED) {
      throw new AppError('Exportação Criare está desabilitada.', 503, 'CREARE_DISABLED');
    }
    const parsed = parseCreareConfigs(env.CREARE_STORE_CONFIG_JSON);
    if (parsed.errors.length) {
      throw new AppError(
        `Configuração Criare incompleta (${parsed.errors.join(', ')}).`,
        503,
        'CREARE_MISCONFIGURED',
      );
    }
    const config = parsed.configs[store];
    if (!config) {
      throw new AppError(`Loja ${store} não possui configuração Criare.`, 503, 'CREARE_STORE_NOT_CONFIGURED');
    }
    const products = await this.products.list(store, {});
    if (!products.length) throw new AppError(`A loja ${store} não possui produtos para exportar.`, 422, 'CREARE_EMPTY');
    try {
      const file = Creare.generateCreareFile(products, config);
      // O serializer limita a saída a ASCII; assim os bytes são idênticos
      // em ASCII, UTF-8 e CP1252 e nenhuma acentuação desloca o registro.
      return Buffer.from(file, 'ascii');
    } catch (error) {
      if (error instanceof Creare.CreareValidationError) {
        throw new AppError(error.message, 422, 'CREARE_PRODUCT_INVALID');
      }
      throw error;
    }
  }
}

