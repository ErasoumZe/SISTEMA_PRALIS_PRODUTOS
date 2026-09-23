import { injectable } from 'tsyringe';
import { and, count, eq, ne } from 'drizzle-orm';
import { db } from '@/db/databases';
import { products } from './product.table';
import { AppError } from '@/config/api.replies';

/**
 * Zerar o catálogo: apaga TODOS os produtos do banco.
 *
 * Existe porque o catálogo acumulou 4.088 cadastros de importações antigas e a
 * decisão foi recomeçar a partir da planilha nova. Fazer isso por SQL solto no
 * terminal do Coolify seria pior: sem backup, sem confirmação e sem registro.
 *
 * O QUE ELE NÃO FAZ — e é o mais importante daqui:
 *
 * **Não toca na planilha.** A planilha é a FONTE de onde o catálogo vai ser
 * repovoado logo em seguida; limpar as linhas dela junto apagaria justamente o
 * que se pretende importar. É o oposto de `ProductService.delete`, que limpa a
 * linha de propósito porque ali o produto está saindo de cena de verdade.
 *
 * As tabelas filhas (fiscal, promoções, transformação, fila de sincronismo)
 * somem por `ON DELETE CASCADE` — nenhuma delas é apagada à mão aqui, para não
 * haver duas verdades sobre o que cascateia.
 */
@injectable()
export class ProductZerarService {
  /** Frase que o administrador precisa digitar. Clique só não basta. */
  static readonly CONFIRMACAO = 'ZERAR CATALOGO E MANTER 13125';
  static readonly CODIGO_PILOTO = '13125';

  private async piloto() {
    const encontrados = await db.select({ id: products.id, nome: products.nome })
      .from(products)
      .where(and(eq(products.loja, 'BASE'), eq(products.codigoInterno, ProductZerarService.CODIGO_PILOTO)));
    if (encontrados.length !== 1) {
      throw new AppError(
        `Limpeza bloqueada: é obrigatório existir exatamente um produto BASE com código interno ${ProductZerarService.CODIGO_PILOTO}; encontrados: ${encontrados.length}.`,
        409,
        'PILOTO_NAO_ENCONTRADO',
      );
    }
    return encontrados[0]!;
  }

  async contar(): Promise<number> {
    const [r] = await db.select({ total: count() }).from(products);
    return Number(r?.total ?? 0);
  }

  async previa(): Promise<{ total: number; apagaveis: number; piloto: { codigoInterno: string; nome: string } }> {
    const [total, piloto] = await Promise.all([this.contar(), this.piloto()]);
    return {
      total,
      apagaveis: Math.max(0, total - 1),
      piloto: { codigoInterno: ProductZerarService.CODIGO_PILOTO, nome: piloto.nome },
    };
  }

  /**
   * @param confirmacao frase digitada pelo administrador
   * @param totalEsperado quantos produtos ele VIU antes de mandar apagar
   *
   * O `totalEsperado` não é burocracia: é trava de concorrência. Se alguém
   * cadastrou enquanto a tela estava aberta, o número muda e a operação para —
   * melhor recusar e mostrar o número novo do que apagar mais do que a pessoa
   * decidiu apagar.
   */
  async zerar(confirmacao: string, totalEsperado: number): Promise<{ apagados: number; preservado: { codigoInterno: string; nome: string } }> {
    if (confirmacao.trim().toUpperCase() !== ProductZerarService.CONFIRMACAO) {
      throw new AppError(
        `Confirmação incorreta. Digite exatamente "${ProductZerarService.CONFIRMACAO}".`,
        400,
        'ZERAR_CONFIRMACAO_INVALIDA',
      );
    }

    const [total, piloto] = await Promise.all([this.contar(), this.piloto()]);
    if (total !== totalEsperado) {
      throw new AppError(
        `O catálogo tem ${total} produtos agora, e não ${totalEsperado} como a tela mostrava. `
        + 'Nada foi apagado; recarregue e confira antes de repetir.',
        409,
        'ZERAR_TOTAL_MUDOU',
      );
    }

    if (total <= 1) return { apagados: 0, preservado: { codigoInterno: ProductZerarService.CODIGO_PILOTO, nome: piloto.nome } };

    const apagados = await db.delete(products).where(ne(products.id, piloto.id)).returning({ id: products.id });
    return { apagados: apagados.length, preservado: { codigoInterno: ProductZerarService.CODIGO_PILOTO, nome: piloto.nome } };
  }
}
