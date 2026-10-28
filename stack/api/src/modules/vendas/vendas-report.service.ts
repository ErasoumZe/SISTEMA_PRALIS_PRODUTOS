import { inject, injectable } from 'tsyringe';
import { AppError } from '@/config/api.replies';
import { VendasReportRepository } from './vendas-report.repository';
import { FatorPontosService } from './fator-pontos.service';
import { chaveProduto, escolherFonte, fonteParaResposta, produtosItens, resumoItens, serieItens, type PedidoFonte } from './vendas-fonte';
import { calcularMargem, filtroVazio, indexarPorCodigo, passaNoFiltro, resolverProduto, type FiltroCadastro } from './vendas-margem';
import { FatorPontos, type VendasSchemas } from '@pralis/shared';

type ProdutoRanking = VendasSchemas.ProdutoRanking;
type VendasReport = VendasSchemas.VendasReport;

type Loja = 'TNP' | 'LI';

@injectable()
export class VendasReportService {
  constructor(
    @inject(VendasReportRepository) private repository: VendasReportRepository,
    @inject(FatorPontosService) private fatores?: FatorPontosService,
  ) {}

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
    const [todosProdutos, payments, cadastro, dePara, diario, regraTicket, incompletos] = await Promise.all([
      itens ? produtosItens(loja, fonte) : this.repository.produtos(loja, inicio, fim),
      // formas de pagamento só existem no fechamento: respeitam só a DATA
      this.repository.pagamentos(loja, inicio, fim),
      this.repository.produtosDaLoja(loja),
      this.repository.deParaDaLoja(loja),
      itens ? Promise.resolve(null) : this.repository.resumo(loja, inicio, fim),
      this.fatores?.vigenteEm(loja, inicio) ?? Promise.resolve(null),
      this.repository.diasFechamentoIncompleto?.(loja, inicio, fim) ?? Promise.resolve([] as string[]),
    ]);
    // Um dia com fechamento incompleto derruba o fechamento do período inteiro:
    // misturar fechamento num dia e itens no outro somaria grãos diferentes.
    const fechamentoConfiavel = incompletos.length === 0;
    const indice = indexarPorCodigo(cadastro);
    const filtrando = !filtroVazio(filtro);
    const products = filtrando
      ? todosProdutos.filter((p) => passaNoFiltro(resolverProduto(p.produtoCodigo, p.produto, indice, dePara), p, filtro))
      : todosProdutos;
    // O total oficial é o mesmo fechamento que alimenta a aba Pagamentos.
    // Itens têm outro grão: descontos, cancelamentos e lançamentos do caixa
    // podem fazer sua soma divergir. Um recorte por produto/hora/PDV não tem
    // fechamento equivalente; nesse caso mostramos valor dos itens, sem
    // chamá-lo de faturamento oficial na interface.
    const recorteDeItens = filtrando || (itens && !!(pedido.hi || pedido.hf || pedido.pdv));
    const origemFaturamento = !recorteDeItens && payments.length > 0 && fechamentoConfiavel
      ? 'fechamento' as const : 'itens' as const;
    /*
     * Na fonte de itens o filtro de cadastro alcança TUDO: as chaves dos
     * produtos que passaram voltam para o SQL, e nº de vendas, ticket e série
     * saem só dos cupons com esses itens. Na diária, só os itens obedecem.
     */
    const chaves = itens && filtrando ? products.map((p) => chaveProduto(p.produtoCodigo, p.produto)) : null;
    const granularidade: 'hora' | 'dia' = origemFaturamento === 'itens' && itens && (pedido.granularidade === 'hora' || (!pedido.granularidade && days === 0))
      ? 'hora' : 'dia';
    const [resumoItensR, serieDeItens] = itens
      ? await Promise.all([resumoItens(loja, fonte, chaves), serieItens(loja, fonte, chaves, granularidade)])
      : [null, fechamentoConfiavel
        ? payments.map((p) => ({ t: p.data, total: p.total, numeroVendas: p.numeroVendas }))
        : await this.repository.serieProdutosDia(loja, inicio, fim)];
    const serie = origemFaturamento === 'fechamento'
      ? payments.map((p) => ({ t: p.data, total: p.total, numeroVendas: p.numeroVendas }))
      : serieDeItens;
    const diasComVendas = origemFaturamento === 'fechamento'
      ? itens
        ? serieDeItens.filter((p) => p.numeroVendas > 0 || p.total !== 0).map((p) => p.t.slice(0, 10))
        : await this.repository.diasComVendasProdutos(loja, inicio, fim)
      : [];
    const diasFechados = new Set(payments.map((p) => p.data));
    const diasSemFechamento = [...new Set(diasComVendas.filter((dia) => !diasFechados.has(dia)))];

    // A margem sai do MESMO agregado do ranking: produto x periodo.
    const margem = calcularMargem(
      products.map((p) => ({ produtoCodigo: p.produtoCodigo, produto: p.produto, quantidade: p.quantidade, total: p.faturamento })),
      indice,
      dePara,
    );
    const faturamentoItens = products.reduce((s, p) => s + p.faturamento, 0);
    const quantidadeItens = products.reduce((s, p) => s + p.quantidade, 0);
    const valorItens = resumoItensR ? resumoItensR.faturamento : filtrando ? faturamentoItens : diario!.faturamento;
    const totalFechamento = payments.reduce((s, p) => s + p.total, 0);
    const vendasFechamento = payments.reduce((s, p) => s + p.numeroVendas, 0);
    const diferencaItensFechamento = payments.length && !recorteDeItens
      ? Math.round((totalFechamento - valorItens) * 100) / 100 : null;
    const resumo = resumoItensR
      ? {
        faturamento: origemFaturamento === 'fechamento' ? totalFechamento : valorItens,
        origemFaturamento, valorItens, diferencaItensFechamento, diasSemFechamento,
        diasFechamentoIncompleto: incompletos,
        quantidade: resumoItensR.quantidade,
        numeroVendas: origemFaturamento === 'fechamento' ? vendasFechamento : resumoItensR.numeroVendas,
        totalPagamentos: totalFechamento,
        ticketMedio: origemFaturamento === 'fechamento'
          ? (vendasFechamento ? totalFechamento / vendasFechamento : 0)
          : (resumoItensR.numeroVendas ? valorItens / resumoItensR.numeroVendas : 0),
        unidadeTicketMedio: {
          emPontos: regraTicket?.ticketEmPontos ?? false,
          fator: regraTicket?.ticketMedio ?? FatorPontos.FATOR_PADRAO,
        },
      }
      : {
        faturamento: origemFaturamento === 'fechamento' ? totalFechamento : valorItens,
        origemFaturamento, valorItens, diferencaItensFechamento, diasSemFechamento,
        diasFechamentoIncompleto: incompletos,
        quantidade: filtrando ? quantidadeItens : diario!.quantidade,
        // Antes dos cupons só o fechamento conta vendas; incompleto, não há
        // contagem confiável — zero, e a tela diz que está indisponível.
        numeroVendas: fechamentoConfiavel ? diario!.numeroVendas : 0,
        totalPagamentos: diario!.totalPagamentos,
        ticketMedio: fechamentoConfiavel && diario!.numeroVendas ? diario!.totalPagamentos / diario!.numeroVendas : 0,
        unidadeTicketMedio: {
          emPontos: regraTicket?.ticketEmPontos ?? false,
          fator: regraTicket?.ticketMedio ?? FatorPontos.FATOR_PADRAO,
        },
      };
    // ABC classifica produtos; seu denominador é somente o valor dos itens,
    // jamais o fechamento oficial que pode conter outros lançamentos.
    const abc = abcSummary(products, faturamentoItens);
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

