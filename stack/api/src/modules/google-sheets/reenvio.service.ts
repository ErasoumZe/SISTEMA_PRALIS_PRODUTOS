import { inject, injectable } from 'tsyringe';
import { and, asc, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { productSheetSync } from './product-sheet-sync.table';
import { ProductSheetService } from './product-sheet.service';
import { ProductSheetLojaService } from './product-sheet-loja.service';
import { ProductRepository } from '@/modules/product/product.repository';

/**
 * Reenvio automático do que a planilha não aceitou.
 *
 * A tabela `product_sheet_sync` já era uma outbox — tinha `status`, `attempts`
 * e `lastError` — mas ninguém a lia de volta. Quando o Google falhava, a tela
 * avisava "sincronização pendente" e a linha ficava ali, esperando alguém abrir
 * o produto e salvar de novo. Na prática, ninguém abria.
 *
 * Aqui só existe o que faltava: escolher quem tentar de novo, tentar, e parar
 * de tentar quando não adianta mais.
 */

/** Quantas tentativas antes de considerar que insistir não resolve. */
export const TETO_TENTATIVAS = 8;

/**
 * Espera antes da PRÓXIMA tentativa, em minutos, por número de tentativas.
 *
 * Cresce porque as falhas do Sheets são quase sempre de dois tipos: passageira
 * (rede, cota do minuto) ou permanente (aba renomeada, permissão retirada). A
 * primeira passa em segundos; a segunda não passa nunca. Reenviar de imediato
 * atende mal aos dois casos — queima cota da API brigando com um erro que não
 * vai ceder, e ainda atrasa quem só precisava de um segundo.
 */
export const esperaEmMinutos = (tentativas: number): number =>
  Math.min(2 ** Math.max(0, tentativas - 1), 60);

export interface ResultadoReenvio {
  tentados: number;
  sincronizados: number;
  falharam: number;
  desistidos: number;
  /** Quantos voltaram à fila por resgate explícito nesta rodada. */
  reanimados: number;
}

export interface OpcoesReenvio {
  /**
   * Devolve à fila quem já estourou o teto de tentativas.
   *
   * Fica DESLIGADO por padrão e só o gatilho manual o liga: o teto existe para
   * impedir que a rotina brigue para sempre com um erro que não cede. Ligar
   * isto é dizer "a causa foi corrigida, pode insistir de novo" — e isso é uma
   * afirmação humana, não algo que um temporizador deva concluir sozinho.
   */
  incluirDesistidos?: boolean;
}

@injectable()
export class ReenvioSheetsService {
  constructor(
    @inject(ProductSheetService) private sheets: ProductSheetService,
    @inject(ProductSheetLojaService) private sheetsLoja: ProductSheetLojaService,
    @inject(ProductRepository) private produtos: ProductRepository,
  ) {}

  /**
   * Quem está esperando reenvio AGORA: pendente ou falhado, abaixo do teto de
   * tentativas e com a espera já cumprida.
   */
  async aguardando(limite = 50): Promise<string[]> {
    const linhas = await db
      .select({ productId: productSheetSync.productId })
      .from(productSheetSync)
      .where(and(
        inArray(productSheetSync.status, ['pending', 'failed']),
        lt(productSheetSync.attempts, TETO_TENTATIVAS),
        /*
         * A espera é calculada no banco a partir de `attempts`, e não em
         * memória: assim duas execuções simultâneas enxergam a mesma fila e
         * não brigam pela mesma linha logo depois de uma delas falhar.
         */
        or(
          sql`${productSheetSync.attempts} = 0`,
          sql`${productSheetSync.updatedAt} < now() - (least(power(2, greatest(${productSheetSync.attempts} - 1, 0)), 60) * interval '1 minute')`,
        ),
      ))
      .orderBy(asc(productSheetSync.updatedAt))
      .limit(limite);
    return linhas.map((l) => l.productId);
  }

  /** Quantos desistiram: bateram no teto e não serão mais tentados sozinhos. */
  async desistidos(): Promise<number> {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(productSheetSync)
      .where(and(
        inArray(productSheetSync.status, ['pending', 'failed']),
        sql`${productSheetSync.attempts} >= ${TETO_TENTATIVAS}`,
      ));
    return Number(r?.n ?? 0);
  }

  /**
   * Tenta de novo, um a um.
   *
   * SEQUENCIAL de propósito: `syncProduct` já entra na fila interna do serviço
   * de planilha, e disparar em paralelo só empilharia espera lá dentro — com o
   * bônus de estourar a cota por minuto do Sheets.
   *
   * Nunca lança: é rotina de fundo. Uma falha aqui vira contagem, não exceção
   * que derruba o processo.
   */
  async reprocessar(limite = 50, opcoes: OpcoesReenvio = {}): Promise<ResultadoReenvio> {
    const reanimados = opcoes.incluirDesistidos ? await this.reanimarDesistidos() : 0;
    const fila = await this.aguardando(limite);
    let sincronizados = 0;
    let falharam = 0;

    for (const productId of fila) {
      try {
        const r = await this.sheets.syncProduct(productId);
        if (r.outcome === 'synced') {
          sincronizados += 1;
          await this.espelharNasAbasDeLoja(productId, r.rowNumber);
        } else falharam += 1;
      } catch {
        // `syncProduct` já registra o erro na própria linha da fila
        falharam += 1;
      }
    }

    return {
      tentados: fila.length,
      sincronizados,
      falharam,
      desistidos: await this.desistidos(),
      reanimados,
    };
  }

  /**
   * Devolve à fila quem bateu no teto, zerando as tentativas.
   *
   * Zera `attempts` em vez de só mudar o status porque a espera é calculada a
   * partir dele: deixar em 8 faria a linha voltar a esperar a hora inteira do
   * topo da curva, e o pedido humano de "tenta agora" viraria "tenta daqui a
   * uma hora". `updated_at` também recua, pela mesma razão.
   *
   * Mexe SÓ em quem já estourou o teto. Quem ainda tem tentativas está no meio
   * da própria espera — zerar por tabela devolveria à fila, agora, alguém que
   * acabou de falhar, que é justamente o que a curva evita.
   */
  async reanimarDesistidos(): Promise<number> {
    const r = await db
      .update(productSheetSync)
      .set({ attempts: 0, status: 'pending', updatedAt: new Date(0) })
      .where(and(
        inArray(productSheetSync.status, ['pending', 'failed']),
        sql`${productSheetSync.attempts} >= ${TETO_TENTATIVAS}`,
      ))
      .returning({ productId: productSheetSync.productId });
    return r.length;
  }

  /**
   * Termina o serviço: a linha que entrou na aba combinada tem de entrar
   * TAMBÉM nas abas `(TNP)` e `(LI) CADASTRO PRODUTOS`, na MESMA linha.
   *
   * Elas são cópias linha a linha da combinada, não vistas por fórmula. Gravar
   * só a combinada deixa a linha em branco nelas e desalinha a próxima — foi o
   * que quebrou a linha 1198. Cadastro e edição já faziam isto; o reenvio não,
   * e era por onde o defeito voltava sem ninguém ver.
   *
   * Nunca lança, e uma falha aqui NÃO desconta o que a combinada já recebeu: a
   * linha continua na fila com o estado dela, e a próxima rodada tenta de novo.
   * Marcar como falha o que foi gravado faria o reenvio reescrever a combinada
   * à toa, a 20 segundos por produto.
   */
  private async espelharNasAbasDeLoja(productId: string, linha: number | null): Promise<void> {
    if (linha == null) return;
    try {
      const produto = await this.produtos.findById(productId);
      if (!produto) return;
      await this.sheetsLoja.espelharNasAbasDeLoja([{ produto, linha }]);
    } catch {
      // rotina de fundo: falha aqui é a próxima rodada, não exceção que derruba
    }
  }
}
