import { inject, injectable } from 'tsyringe';
import { AppError } from '@/config/api.replies';
import { VendasReportRepository } from './vendas-report.repository';
import { calcularMargem, indexarPorCodigo } from './vendas-margem';
import type { VendasSchemas } from '@pralis/shared';

type ProdutoRanking = VendasSchemas.ProdutoRanking;
type VendasReport = VendasSchemas.VendasReport;

type Loja = 'TNP' | 'LI';

@injectable()
export class VendasReportService {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  async report(loja: Loja, inicio: string, fim: string): Promise<VendasReport> {
    const start = new Date(`${inicio}T00:00:00Z`);
    const end = new Date(`${fim}T00:00:00Z`);
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
    if (days < 0) throw new AppError('Data inicial deve ser anterior à final.', 422, 'INVALID_PERIOD');
    if (days > 366) throw new AppError('O período máximo do relatório é de 366 dias.', 422, 'PERIOD_TOO_LARGE');

    const [summary, products, payments, cadastro, dePara] = await Promise.all([
      this.repository.resumo(loja, inicio, fim),
      this.repository.produtos(loja, inicio, fim),
      this.repository.pagamentos(loja, inicio, fim),
      this.repository.produtosDaLoja(loja),
      this.repository.deParaDaLoja(loja),
    ]);
    // A margem sai do MESMO agregado do ranking: produto x periodo. Casar por
    // `barcodeCandidates` faz o pesavel casar sozinho; o que sobrar aparece
    // como cobertura menor que 100%, nunca como margem inventada.
    const margem = calcularMargem(
      products.map((p) => ({ produtoCodigo: p.produtoCodigo, produto: p.produto, quantidade: p.quantidade, total: p.faturamento })),
      indexarPorCodigo(cadastro),
      dePara,
    );
    const total = summary.faturamento;
    const abc = abcSummary(products, total);
    const byQuantity = [...products].sort((a, b) => b.quantidade - a.quantidade || b.faturamento - a.faturamento);
    const bottom = [...products]
      .filter((p) => p.quantidade > 0)
      .sort((a, b) => a.quantidade - b.quantidade || a.faturamento - b.faturamento);

    return {
      loja,
      periodo: { inicio, fim },
      resumo: {
        faturamento: summary.faturamento,
        quantidade: summary.quantidade,
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

