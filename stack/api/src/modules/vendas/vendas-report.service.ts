import { inject, injectable } from 'tsyringe';
import { AppError } from '@/config/api.replies';
import { VendasReportRepository } from './vendas-report.repository';
import { chaveProduto, escolherFonte, fonteParaResposta, produtosItens, resumoItens, serieItens, type PedidoFonte } from './vendas-fonte';
import { calcularMargem, filtroVazio, indexarPorCodigo, passaNoFiltro, resolverProduto, type FiltroCadastro } from './vendas-margem';
import type { VendasSchemas } from '@pralis/shared';

type ProdutoRanking = VendasSchemas.ProdutoRanking;
type VendasReport = VendasSchemas.VendasReport;

type Loja = 'TNP' | 'LI';

@injectable()
export class VendasReportService {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  async report(
    loja: Loja,
    inicio: string,
    fim: string,
    filtro: FiltroCadastro = {},
    pedido: PedidoFonte & { granularidade?: 'hora' | 'dia' } = {},
  ): Promise<VendasReport> {
    const start = new Date(`${inicio}T00:00:00Z`);
    const end = new Date(`${fim}T00:00:00Z`);
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
    if (days < 0) throw new AppError('Data inicial deve ser anterior à final.', 422, 'INVALID_PERIOD');
    if (days > 366) throw new AppError('O período máximo do relatório é de 366 dias.', 422, 'PERIOD_TOO_LARGE');

    const fonte = escolherFonte(inicio, fim, pedido, (await this.repository.desdeItens?.(loja)) ?? null);
    const itens = fonte.tipo === 'itens';
    const [todosProdutos, payments, cadastro, dePara, diario] = await Promise.all([
      itens ? produtosItens(loja, fonte) : this.repository.produtos(loja, inicio, fim),
      // formas de pagamento só existem no fechamento: respeitam só a DATA
      this.repository.pagamentos(loja, inicio, fim),
      this.repository.produtosDaLoja(loja),
      this.repository.deParaDaLoja(loja),
      itens ? Promise.resolve(null) : this.repository.resumo(loja, inicio, fim),
    ]);
    const indice = indexarPorCodigo(cadastro);
    const filtrando = !filtroVazio(filtro);
    const products = filtrando
      ? todosProdutos.filter((p) => passaNoFiltro(resolverProduto(p.produtoCodigo, p.produto, indice, dePara), p, filtro))
      : todosProdutos;
    /*
     * Na fonte de itens o filtro de cadastro alcança TUDO: as chaves dos
     * produtos que passaram voltam para o SQL, e nº de vendas, ticket e série
     * saem só dos cupons com esses itens. Na diária, só os itens obedecem.
     */
    const chaves = itens && filtrando ? products.map((p) => chaveProduto(p.produtoCodigo, p.produto)) : null;
    const granularidade: 'hora' | 'dia' = itens && (pedido.granularidade === 'hora' || (!pedido.granularidade && days === 0))
      ? 'hora' : 'dia';
    const [resumoItensR, serie] = itens
      ? await Promise.all([resumoItens(loja, fonte, chaves), serieItens(loja, fonte, chaves, granularidade)])
      : [null, payments.map((p) => ({ t: p.data, total: p.total, numeroVendas: p.numeroVendas }))];

    // A margem sai do MESMO agregado do ranking: produto x periodo.
    const margem = calcularMargem(
      products.map((p) => ({ produtoCodigo: p.produtoCodigo, produto: p.produto, quantidade: p.quantidade, total: p.faturamento })),
      indice,
      dePara,
    );
    const faturamentoItens = products.reduce((s, p) => s + p.faturamento, 0);
    const quantidadeItens = products.reduce((s, p) => s + p.quantidade, 0);
    const resumo = resumoItensR
      ? {
        faturamento: resumoItensR.faturamento,
        quantidade: resumoItensR.quantidade,
        numeroVendas: resumoItensR.numeroVendas,
        // sem fechamento no recorte: o "total pago" é o que os cupons somaram
        totalPagamentos: resumoItensR.faturamento,
        ticketMedio: resumoItensR.numeroVendas ? resumoItensR.faturamento / resumoItensR.numeroVendas : 0,
      }
      : {
        faturamento: filtrando ? faturamentoItens : diario!.faturamento,
        quantidade: filtrando ? quantidadeItens : diario!.quantidade,
        numeroVendas: diario!.numeroVendas,
        totalPagamentos: diario!.totalPagamentos,
        ticketMedio: diario!.numeroVendas ? diario!.totalPagamentos / diario!.numeroVendas : 0,
      };
    const abc = abcSummary(products, filtrando || itens ? faturamentoItens : resumo.faturamento);
    const byQuantity = [...products].sort((a, b) => b.quantidade - a.quantidade || b.faturamento - a.faturamento);
    const bottom = [...products]
      .filter((p) => p.quantidade > 0)
      .sort((a, b) => a.quantidade - b.quantidade || a.faturamento - b.faturamento);

    return {
      loja,
      periodo: { inicio, fim, granularidade },
      filtros: {
        setor: filtro.setor?.trim() || null,
        grupo: filtro.grupo?.trim() || null,
        produto: filtro.produto?.trim() || null,
        ativo: filtrando,
        alcance: itens ? 'tudo' : 'itens',
      },
      fonte: fonteParaResposta(fonte),
      serie,
      resumo,
      ranking: { maisVendidos: byQuantity.slice(0, 10), menosVendidos: bottom.slice(0, 10) },
      curvaAbc: abc,
      pagamentos: payments,
      margem,
      qualidade: {
        produtosSemCodigo: resumoItensR ? resumoItensR.produtosSemCodigo : diario!.produtosSemCodigo,
        faturamentoSemCodigo: resumoItensR ? resumoItensR.faturamentoSemCodigo : diario!.faturamentoSemCodigo,
        outrosPagamento: diario ? diario.outrosPagamento : 0,
      },
    };
  }

}

export function abcSummary(products: ProdutoRanking[], total: number): VendasReport['curvaAbc'] {
  const grouped = new Map<'A' | 'B' | 'C', { produtos: number; faturamento: number }>([
    ['A', { produtos: 0, faturamento: 0 }], ['B', { produtos: 0, faturamento: 0 }], ['C', { produtos: 0, faturamento: 0 }],
  ]);
  let accumulated = 0;
  for (const product of [...products].sort((a, b) => b.faturamento - a.faturamento)) {
    const before = total > 0 ? accumulated / total : 1;
    const className: 'A' | 'B' | 'C' = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C';
    const group = grouped.get(className)!;
    group.produtos += 1;
    group.faturamento += product.faturamento;
    accumulated += product.faturamento;
  }
  return (['A', 'B', 'C'] as const).map((classe) => {
    const group = grouped.get(classe)!;
    return { classe, ...group, percentual: total ? (group.faturamento / total) * 100 : 0 };
  });
}

