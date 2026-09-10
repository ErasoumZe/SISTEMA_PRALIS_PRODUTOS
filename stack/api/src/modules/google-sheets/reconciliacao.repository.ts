import { injectable } from 'tsyringe';
import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '@/db/databases';
import { products } from '@/modules/product/product.table';

/**
 * Leitura MÍNIMA do catálogo para a reconciliação.
 *
 * De propósito não reaproveita `ProductRepository.list`: aquele método traz
 * promoções, transformação e fiscal de cada produto em três consultas extras.
 * Aqui só interessam identidade e nome — e a aba tem 9.930 linhas, então o
 * relatório é varrido inteiro toda vez que alguém abre a tela.
 */
export interface ProdutoDoCatalogo {
  id: string;
  codigo: string;
  codigoInterno: string | null;
  nome: string;
  status: string;
}

@injectable()
export class ReconciliacaoRepository {
  /**
   * Produtos do catálogo BASE, que é o único espelhado na planilha.
   *
   * `status <> 'unificado'` pelo mesmo motivo das listagens: o cadastro
   * aposentado por unificação continua no banco para o desfazer, mas não é
   * mais um produto — cobrá-lo da planilha inventaria divergência que não há.
   */
  async listarBase(loja = 'BASE'): Promise<ProdutoDoCatalogo[]> {
    return db
      .select({
        id: products.id,
        codigo: products.codigo,
        codigoInterno: products.codigoInterno,
        nome: products.nome,
        status: products.status,
      })
      .from(products)
      .where(and(eq(products.loja, loja), ne(products.status, 'unificado')))
      .orderBy(asc(products.nome));
  }
}
