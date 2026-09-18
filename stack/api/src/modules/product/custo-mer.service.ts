import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { AppError } from '@/config/api.replies';
import { db } from '@/db/databases';
import type { CurrentUser } from '@/types/fastify-jwt';
import { ProductSheetService } from '@/modules/google-sheets/product-sheet.service';
import { products } from './product.table';
import { CustoMerPlanilhaService, type EstadoMer } from './custo-mer.planilha';
import { planejarCusto, type MotivoSemCusto, type PropostaCusto } from './custo-mer.motor';

/**
 * Carga de custo a partir da base de discriminação de mercadorias.
 *
 * A regra é o **DB-05** do backlog: o custo do produto é o da compra mais
 * recente nessa base. Não é palpite meu, e por isso está escrito aqui.
 *
 * O que ela NÃO faz: não calcula preço de venda, não mexe em margem. Custo
 * entra como custo; quem transforma custo em preço é o cálculo que já existe,
 * quando o produto tiver o cálculo automático ligado.
 */
export const CONFIRMACAO_CUSTO_MER = 'ATUALIZAR CUSTO DA DISCRIMINACAO';

/** Teto por chamada, como nas outras cargas: a tela repete e mostra o que falta. */
export const LOTE_CUSTO = 300;

export interface PreviaCusto {
  estado: EstadoMer;
  truncada: boolean;
  faltando: string[];
  erro?: string;
  linhaCabecalho: number | null;
  lancamentos: number;
  lancamentosDescartados: number;
  comCusto: number;
  semCusto: Record<MotivoSemCusto, number>;
  amostra: PropostaCusto[];
  confirmacao: string;
  loteMaximo: number;
}

@injectable()
export class CustoMerService {
  constructor(
    @inject(CustoMerPlanilhaService) private planilha: CustoMerPlanilhaService,
    @inject(ProductSheetService) private sheets: ProductSheetService,
  ) {}

  /**
   * Custo é do produto, e o produto da Base é quem manda (DB-04). As cópias de
   * loja recebem por herança pelo caminho que já existe; órfãos entram porque
   * não têm de quem herdar.
   */
  private async produtos() {
    return db.select({ id: products.id, nome: products.nome, custo: products.custo, qtCad: products.qtCad })
      .from(products)
      .where(and(isNull(products.baseProductId), ne(products.status, 'unificado')))
      .orderBy(products.nome);
  }

  private async planejar() {
    const leitura = await this.planilha.ler();
    if (leitura.estado !== 'ok') return { leitura, plano: null };
    return { leitura, plano: planejarCusto(await this.produtos(), leitura.lancamentos) };
  }

  async previa(): Promise<PreviaCusto> {
    const { leitura, plano } = await this.planejar();
    const vazio: Record<MotivoSemCusto, number> = {
      'sem-lancamento': 0, 'nome-ambiguo-no-cadastro': 0, 'custo-ilegivel': 0, 'ja-esta-certo': 0,
    };
    return {
      estado: leitura.estado,
      truncada: leitura.truncada,
      faltando: leitura.faltando,
      erro: leitura.erro,
      linhaCabecalho: leitura.linhaCabecalho,
      lancamentos: leitura.lancamentos.length,
      lancamentosDescartados: leitura.descartados,
      comCusto: plano?.comCusto ?? 0,
      semCusto: plano?.semCusto ?? vazio,
      amostra: (plano?.propostas ?? []).filter((p) => p.custoNovo !== null).slice(0, 25),
      confirmacao: CONFIRMACAO_CUSTO_MER,
      loteMaximo: LOTE_CUSTO,
    };
  }

  async aplicar(user: CurrentUser, confirmacao: string) {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_CUSTO_MER) {
      throw new AppError(`Frase de confirmação inválida. Digite "${CONFIRMACAO_CUSTO_MER}" para gravar.`, 400);
    }
    const { leitura, plano } = await this.planejar();
    if (leitura.estado !== 'ok' || !plano) {
      throw new AppError('A base de discriminação não pôde ser lida agora; nada foi gravado.', 503);
    }

    const alvos = plano.propostas.filter((p) => p.custoNovo !== null).slice(0, LOTE_CUSTO);
    let aplicados = 0;
    let conflitos = 0;
    const espelhar: string[] = [];

    for (const p of alvos) {
      /*
       * Casa o custo ANTERIOR: se alguém editou o produto entre a prévia e o
       * clique, a linha não é atingida e a troca não acontece — em vez de
       * sobrescrever o que a pessoa acabou de digitar.
       */
      const atingidas = await db.update(products)
        .set({ custo: String(p.custoNovo) })
        .where(and(
          eq(products.id, p.productId),
          p.custoAtual === null
            ? isNull(products.custo)
            : sql`${products.custo} = ${String(p.custoAtual)}::numeric`,
        ))
        .returning({ id: products.id });

      if (atingidas.length === 0) { conflitos += 1; continue; }
      aplicados += 1;
      espelhar.push(p.productId);
    }

    // depois das gravações: o espelho é conveniência, o custo é o que importa
    for (const id of espelhar) {
      try {
        await this.sheets.registerPending(id);
      } catch { /* o reenvio periódico recupera */ }
    }

    return { aplicados, conflitos, restantes: Math.max(0, plano.comCusto - alvos.length) };
  }
}
