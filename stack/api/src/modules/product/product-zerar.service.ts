import { injectable } from 'tsyringe';
import { count } from 'drizzle-orm';
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
  static readonly CONFIRMACAO = 'ZERAR CATALOGO';

  async contar(): Promise<number> {
    const [r] = await db.select({ total: count() }).from(products);
    return Number(r?.total ?? 0);
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
  async zerar(confirmacao: string, totalEsperado: number): Promise<{ apagados: number }> {
    if (confirmacao.trim().toUpperCase() !== ProductZerarService.CONFIRMACAO) {
      throw new AppError(
        `Confirmação incorreta. Digite exatamente "${ProductZerarService.CONFIRMACAO}".`,
        400,
        'ZERAR_CONFIRMACAO_INVALIDA',
      );
    }

    const total = await this.contar();
    if (total !== totalEsperado) {
      throw new AppError(
        `O catálogo tem ${total} produtos agora, e não ${totalEsperado} como a tela mostrava. `
        + 'Nada foi apagado; recarregue e confira antes de repetir.',
        409,
        'ZERAR_TOTAL_MUDOU',
      );
    }

    if (total === 0) return { apagados: 0 };

    const apagados = await db.delete(products).returning({ id: products.id });
    return { apagados: apagados.length };
  }
}
