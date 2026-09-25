import { inject, injectable } from 'tsyringe';
import type { VendasAbc } from '@pralis/shared';
import { AppError } from '@/config/api.replies';
import { VendasReportRepository } from './vendas-report.repository';
import { filtroVazio, indexarPorCodigo, passaNoFiltro, resolverProduto, type FiltroCadastro } from './vendas-margem';
import { escolherFonte, produtosItens, type Fonte, type PedidoFonte } from './vendas-fonte';
import { classificarAbc, diasDeMaximo } from './vendas-abc';

type Loja = 'BASE' | 'TNP' | 'LI';

/**
 * A lista de produtos da curva ABC, com o cadastro ao lado.
 *
 * Responde a pergunta que o resumo da curva não responde: QUAIS produtos não
 * podem faltar. E, para cada um, o que o sistema sabe hoje — custo, mínimo,
 * máximo, grupo, setor — e o que ele não sabe.
 */
@injectable()
export class VendasAbcService {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  async produtos(
    loja: Loja,
    inicio: string,
    fim: string,
    classe?: 'A' | 'B' | 'C',
    filtro: FiltroCadastro = {},
    pedido: PedidoFonte = {},
  ): Promise<VendasAbc.AbcProdutos> {
    const inicioMs = new Date(`${inicio}T00:00:00Z`).getTime();
    const fimMs = new Date(`${fim}T00:00:00Z`).getTime();
    const vao = Math.floor((fimMs - inicioMs) / 86_400_000);
    if (vao < 0) throw new AppError('Data inicial deve ser anterior à final.', 422, 'INVALID_PERIOD');
    if (vao > 366) throw new AppError('O período máximo do relatório é de 366 dias.', 422, 'PERIOD_TOO_LARGE');
    /* O período INCLUI os dois extremos: de 01 a 01 é um dia, não zero. */
    const dias = vao + 1;

    // BASE soma as duas lojas pelo diário; loja própria usa os cupons quando cobrem o período
    const fonte: Fonte | null = loja === 'BASE' ? null : escolherFonte(inicio, fim, pedido, (await this.repository.desdeItens?.(loja)) ?? null);
    const [vendas, cadastro, dePara] = await Promise.all([
      loja === 'BASE'
        ? this.repository.produtosDaBase(inicio, fim)
        : fonte!.tipo === 'itens' ? produtosItens(loja, fonte!) : this.repository.produtos(loja, inicio, fim),
      this.repository.produtosDaLoja(loja),
      loja === 'BASE' ? Promise.resolve(new Map()) : this.repository.deParaDaLoja(loja),
    ]);
    const indice = indexarPorCodigo(cadastro);

    /*
     * O filtro entra ANTES da classificação: a curva é recalculada sobre o
     * recorte, então "classe A do setor padaria" é a A DENTRO da padaria — que
     * é a pergunta que quem filtra está fazendo.
     */
    const recorte = filtroVazio(filtro)
      ? vendas
      : vendas.filter((v) => passaNoFiltro(resolverProduto(v.produtoCodigo, v.produto, indice, dePara), v, filtro));
    const total = recorte.reduce((s, v) => s + v.faturamento, 0);
    const classificados = classificarAbc(recorte, total);

    let semCadastro = 0;
    let semEstoqueMax = 0;

    const itens = classificados
      .filter((c) => !classe || c.classe === classe)
      .map((c) => {
        const p = resolverProduto(c.produtoCodigo, c.produto, indice, dePara);
        if (!p) semCadastro += 1;
        const estoqueMax = p?.estoqueMax ?? null;
        if (p && (estoqueMax == null || estoqueMax <= 0)) semEstoqueMax += 1;

        return {
          classe: c.classe,
          posicao: c.posicao,
          produtoCodigo: c.produtoCodigo,
          produto: c.produto,
          quantidade: c.quantidade,
          faturamento: c.faturamento,
          participacao: c.participacao,
          acumulado: c.acumulado,
          porDia: Math.round((c.quantidade / dias) * 100) / 100,
          productId: p?.id ?? null,
          grupo: p?.grupo ?? null,
          setor: p?.setorEstoque ?? null,
          custo: p?.custo ?? null,
          estoqueMin: p?.estoqueMin ?? null,
          estoqueMax,
          diasDeMaximo: diasDeMaximo(estoqueMax, c.quantidade, dias),
        };
      });

    return {
      loja,
      periodo: { inicio, fim, dias },
      totalProdutos: classificados.length,
      fonte: fonte
        ? { tipo: fonte.tipo, desde: fonte.desde, ignorados: fonte.ignorados }
        : { tipo: 'diario' as const, desde: null, ignorados: [] },
      faturamentoTotal: Math.round(total * 100) / 100,
      itens,
      semCadastro,
      semEstoqueMax,
    };
  }
}
