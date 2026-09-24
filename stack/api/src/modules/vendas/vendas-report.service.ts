import { inject, injectable } from 'tsyringe';
import { AppError } from '@/config/api.replies';
import { VendasReportRepository } from './vendas-report.repository';
import { calcularMargem, filtroVazio, indexarPorCodigo, passaNoFiltro, resolverProduto, type FiltroCadastro } from './vendas-margem';
import type { VendasSchemas } from '@pralis/shared';

type ProdutoRanking = VendasSchemas.ProdutoRanking;
type VendasReport = VendasSchemas.VendasReport;

type Loja = 'TNP' | 'LI';

@injectable()
export class VendasReportService {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  async report(loja: Loja, inicio: string, fim: string, filtro: FiltroCadastro = {}): Promise<VendasReport> {
    const start = new Date(`${inicio}T00:00:00Z`);
    const end = new Date(`${fim}T00:00:00Z`);
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
    if (days < 0) throw new AppError('Data inicial deve ser anterior à final.', 422, 'INVALID_PERIOD');
    if (days > 366) throw new AppError('O período máximo do relatório é de 366 dias.', 422, 'PERIOD_TOO_LARGE');

    const [summary, todosProdutos, payments, cadastro, dePara] = await Promise.all([
      this.repository.resumo(loja, inicio, fim),
      this.repository.produtos(loja, inicio, fim),
      this.repository.pagamentos(loja, inicio, fim),
      this.repository.produtosDaLoja(loja),
      this.repository.deParaDaLoja(loja),
    ]);
    const indice = indexarPorCodigo(cadastro);
    /*
     * O filtro de cadastro corta os ITENS — e só eles. `summary` vem do
     * fechamento (número de vendas, pagamentos) e não tem produto: filtrá-lo
     * exigiria rateio. Quando há filtro, faturamento e quantidade passam a
     * sair dos itens filtrados, e a resposta declara isso em `filtros`.
     */
    const filtrando = !filtroVazio(filtro);
    const products = filtrando
      ? todosProdutos.filter((p) => passaNoFiltro(resolverProduto(p.produtoCodigo, p.produto, indice, dePara), p, filtro))
      : todosProdutos;
    // A margem sai do MESMO agregado do ranking: produto x periodo. Casar por
    // `barcodeCandidates` faz o pesavel casar sozinho; o que sobrar aparece
    // como cobertura menor que 100%, nunca como margem inventada.
    const margem = calcularMargem(
      products.map((p) => ({ produtoCodigo: p.produtoCodigo, produto: p.produto, quantidade: p.quantidade, total: p.faturamento })),
      indice,
      dePara,
    );
    const faturamentoItens = products.reduce((s, p) => s + p.faturamento, 0);
    const quantidadeItens = products.reduce((s, p) => s + p.quantidade, 0);
    const total = filtrando ? faturamentoItens : summary.faturamento;
    const abc = abcSummary(products, total);
    const byQuantity = [...products].sort((a, b) => b.quantidade - a.quantidade || b.faturamento - a.faturamento);
    const bottom = [...products]
      .filter((p) => p.quantidade > 0)
      .sort((a, b) => a.quantidade - b.quantidade || a.faturamento - b.faturamento);

    return {
      loja,
      periodo: { inicio, fim, granularidade: 'dia' },
      filtros: {
        setor: filtro.setor?.trim() || null,
        grupo: filtro.grupo?.trim() || null,
        produto: filtro.produto?.trim() || null,
        ativo: filtrando,
        alcance: 'itens',
      },
      resumo: {
        faturamento: filtrando ? faturamentoItens : summary.faturamento,
        quantidade: filtrando ? quantidadeItens : summary.quantidade,
        numeroVendas: summary.numeroVendas,
        totalPagamentos: summary.totalPagamentos,
        ticketMedio: summary.numeroVendas ? summary.totalPagamentos / summary.numeroVendas : 0,
      },
      ranking: { maisVendidos: byQuantity.slice(0, 10), menosVendidos: bottom.slice(0, 10) },
      curvaAbc: abc,
      pagamentos: payments,
      margem,
      qualidade: {
        produtosSemCodigo: summary.produtosSemCodigo,
        faturamentoSemCodigo: summary.faturamentoSemCodigo,
        outrosPagamento: summary.outrosPagamento,
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

