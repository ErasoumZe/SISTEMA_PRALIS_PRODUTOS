import { inject, injectable } from 'tsyringe';
import { VendasRanking } from '@pralis/shared';
import { AppError } from '@/config/api.replies';
import { VendasReportRepository } from './vendas-report.repository';
import { indexarPorCodigo, resolverProduto, type ProdutoCadastro } from './vendas-margem';
import { agruparPorChave, type LinhaClassificada } from './vendas-ranking';
/** Lojas com relatório nesta etapa — mesma definição dos demais serviços. */
type Loja = 'TNP' | 'LI';

/**
 * Ranking de vendas por dimensão: produto, grupo, setor ou PDV.
 *
 * Três das quatro dimensões saem da MESMA lista de vendas por produto; muda só
 * de onde a chave é lida. A quarta — PDV — vem de outra tabela, porque a venda
 * por produto não guarda em que caixa saiu.
 */

/** Rótulo de quem não tem valor no campo. Aparece como item, não como buraco. */
const SEM_VALOR = 'Sem classificação no cadastro';

@injectable()
export class VendasRankingService {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  async ranking(
    loja: Loja,
    inicio: string,
    fim: string,
    dimensao: VendasRanking.Dimensao,
    campoSetor: 'setorEstoque' | 'setorVenda1' = 'setorEstoque',
  ): Promise<VendasRanking.VendasRanking> {
    const dias = Math.floor(
      (new Date(`${fim}T00:00:00Z`).getTime() - new Date(`${inicio}T00:00:00Z`).getTime()) / 86_400_000,
    );
    if (dias < 0) throw new AppError('Data inicial deve ser anterior à final.', 422, 'INVALID_PERIOD');
    if (dias > 366) throw new AppError('O período máximo do relatório é de 366 dias.', 422, 'PERIOD_TOO_LARGE');

    if (dimensao === 'pdv') return this.porPdv(loja, inicio, fim);

    const [vendas, cadastro, dePara] = await Promise.all([
      this.repository.produtos(loja, inicio, fim),
      this.repository.produtosDaLoja(loja),
      this.repository.deParaDaLoja(loja),
    ]);
    const indice = indexarPorCodigo(cadastro);

    /*
     * `produto` não precisa casar com o cadastro: a própria venda já é a chave.
     * Casar ali só perderia faturamento de produto que o PDV vendeu sem código
     * — e esse é justamente o que mais interessa ver na lista.
     */
    const campo = dimensao === 'grupo' ? 'grupo' : campoSetor;

    const linhas: LinhaClassificada[] = vendas.map((v) => {
      if (dimensao === 'produto') {
        return {
          chave: `${v.produtoCodigo}|${v.produto}`,
          rotulo: v.produto,
          faturamento: v.faturamento,
          quantidade: v.quantidade,
        };
      }
      const produto = resolverProduto(v.produtoCodigo, v.produto, indice, dePara);
      const valor = produto ? (produto[campo as keyof ProdutoCadastro] as string | null | undefined) : undefined;
      /*
       * Duas ausências DIFERENTES, e a diferença importa para quem vai agir:
       *  - venda que não casou com produto nenhum -> `chave: null` -> cobertura.
       *    Conserta-se na tela de de-para.
       *  - produto que casou mas está sem o campo preenchido -> entra no ranking
       *    como "Sem classificação no cadastro". Conserta-se no cadastro.
       * Jogar os dois no mesmo balde mandaria a pessoa para a tela errada.
       */
      if (!produto) {
        return { chave: null, rotulo: v.produto, faturamento: v.faturamento, quantidade: v.quantidade };
      }
      const chave = (valor ?? '').trim();
      return {
        chave: chave || '__sem_valor__',
        rotulo: chave || SEM_VALOR,
        faturamento: v.faturamento,
        quantidade: v.quantidade,
      };
    });

    const r = agruparPorChave(linhas);
    return {
      loja,
      periodo: { inicio, fim },
      dimensao,
      campo: dimensao === 'produto' ? null : campo,
      ...r,
    };
  }

  /**
   * PDV: o dinheiro por caixa, do fechamento.
   *
   * Cobertura é 100% por construção — o fechamento É o total, não uma amostra
   * que precisou casar com cadastro. Dizer 100% aqui não é otimismo: é o que
   * a fonte garante.
   */
  private async porPdv(loja: Loja, inicio: string, fim: string): Promise<VendasRanking.VendasRanking> {
    const linhas = await this.repository.porPdv(loja, inicio, fim);
    const r = agruparPorChave(linhas.map((l) => ({
      chave: l.dispositivoIdErp || `legado:${l.pdv}`,
      rotulo: l.operador ? `${l.pdv} — ${l.operador}` : l.pdv,
      faturamento: l.total,
      quantidade: 0,
      numeroVendas: l.numeroVendas,
    })));

    return {
      loja,
      periodo: { inicio, fim },
      dimensao: 'pdv',
      campo: null,
      ...r,
      // quantidade não existe no fechamento: ele conta VENDAS, não itens
      itens: r.itens.map((i) => ({ ...i, quantidade: null })),
    };
  }
}
