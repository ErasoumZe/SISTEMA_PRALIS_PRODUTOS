import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { CurrentUser } from '@/types/fastify-jwt';
import { reportStore } from './vendas-report.controller';
import { VendasReportService, abcSummary } from './vendas-report.service';
import type { VendasReportRepository } from './vendas-report.repository';
import type { VendasSchemas } from '@pralis/shared';

type ProdutoRanking = VendasSchemas.ProdutoRanking;

const produto = (produtoCodigo: string, quantidade: number, faturamento: number): ProdutoRanking =>
  ({ produtoCodigo, produto: `PROD ${produtoCodigo}`, quantidade, faturamento });

const pedido = (user?: Partial<CurrentUser>): FastifyRequest =>
  ({ currentUser: user ? ({ id: 'u', name: 'n', email: 'e', loja: null, role: 'user', ...user }) : undefined }) as FastifyRequest;

/** Repositório falso: o relatório é aritmética, não SQL. */
function repositorio(over: {
  produtos?: ProdutoRanking[];
  numeroVendas?: number;
  totalPagamentos?: number;
  faturamento?: number;
  pagamentos?: VendasSchemas.PagamentoDia[];
  diasComVendas?: string[];
  /** cadastro da loja; vazio = nada casa e a cobertura fica em 0 */
  cadastro?: Array<{ id: string; nome: string; codigoBarras: string | null; custo: number | null; qtCad: number }>;
} = {}) {
  const produtos = over.produtos ?? [];
  return {
    async resumo() {
      return {
        faturamento: over.faturamento ?? produtos.reduce((s, p) => s + p.faturamento, 0),
        quantidade: produtos.reduce((s, p) => s + p.quantidade, 0),
        produtosSemCodigo: produtos.filter((p) => p.produtoCodigo === '').length,
        faturamentoSemCodigo: produtos.filter((p) => p.produtoCodigo === '').reduce((s, p) => s + p.faturamento, 0),
        numeroVendas: over.numeroVendas ?? 0,
        totalPagamentos: over.totalPagamentos ?? 0,
        outrosPagamento: 0,
      };
    },
    async produtos() { return produtos; },
    async pagamentos() { return over.pagamentos ?? []; },
    async diasComVendasProdutos() { return over.diasComVendas ?? []; },
    async produtosDaLoja() { return over.cadastro ?? []; },
    async deParaDaLoja() { return new Map(); },
  } as unknown as VendasReportRepository;
}

describe('abcSummary — curva ABC', () => {
  it('classifica pelo acumulado: 80% em A, até 95% em B, o resto em C', () => {
    const abc = abcSummary([produto('1', 1, 800), produto('2', 1, 150), produto('3', 1, 30), produto('4', 1, 20)], 1000);

    expect(abc).toEqual([
      { classe: 'A', produtos: 1, faturamento: 800, percentual: 80 },
      { classe: 'B', produtos: 1, faturamento: 150, percentual: 15 },
      { classe: 'C', produtos: 2, faturamento: 50, percentual: 5 },
    ]);
  });

  it('o produto que ATRAVESSA o corte fica na classe em que começou', () => {
    // um único produto responde por tudo: ele começa em 0% e portanto é A,
    // mesmo levando o acumulado a 100%.
    const abc = abcSummary([produto('1', 1, 1000)], 1000);

    expect(abc[0]).toMatchObject({ classe: 'A', produtos: 1, faturamento: 1000 });
    expect(abc[1]).toMatchObject({ classe: 'B', produtos: 0, faturamento: 0 });
  });

  it('faturamento zero não divide por zero', () => {
    const abc = abcSummary([produto('1', 0, 0)], 0);

    expect(abc.every((c) => Number.isFinite(c.percentual))).toBe(true);
    expect(abc.every((c) => c.percentual === 0)).toBe(true);
  });

  it('sem produtos devolve as três classes zeradas, não uma lista vazia', () => {
    expect(abcSummary([], 0).map((c) => c.classe)).toEqual(['A', 'B', 'C']);
  });
});

describe('reportStore — quem pode ver o relatório de qual loja', () => {
  it('não autenticado é 401', () => {
    expect(() => reportStore(pedido())).toThrow(expect.objectContaining({ statusCode: 401 }));
  });

  it('admin precisa dizer a loja', () => {
    expect(() => reportStore(pedido({ role: 'admin', loja: null })))
      .toThrow(expect.objectContaining({ code: 'STORE_REQUIRED' }));
  });

  it('admin com loja informada consulta aquela loja', () => {
    expect(reportStore(pedido({ role: 'admin', loja: null }), 'LI')).toBe('LI');
  });

  it('usuário de loja não precisa informar nada e recebe a própria', () => {
    expect(reportStore(pedido({ role: 'user', loja: 'TNP' }))).toBe('TNP');
  });

  it('usuário de loja NÃO consulta outra loja', () => {
    expect(() => reportStore(pedido({ role: 'user', loja: 'TNP' }), 'LI'))
      .toThrow(expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }));
  });

  it('loja fora do escopo desta etapa (HORA) é recusada', () => {
    expect(() => reportStore(pedido({ role: 'user', loja: 'HORA' })))
      .toThrow(expect.objectContaining({ code: 'STORE_NOT_SUPPORTED' }));
  });
});

describe('VendasReportService — período e agregações', () => {
  const service = (repo: VendasReportRepository) => new VendasReportService(repo);

  it('recusa período invertido', async () => {
    await expect(service(repositorio()).report('TNP', '2026-08-10', '2026-08-01'))
      .rejects.toMatchObject({ code: 'INVALID_PERIOD' });
  });

  it('recusa período maior que 366 dias', async () => {
    await expect(service(repositorio()).report('TNP', '2025-01-01', '2026-08-01'))
      .rejects.toMatchObject({ code: 'PERIOD_TOO_LARGE' });
  });

  it('ticket médio é o pagamento dividido pelo número de vendas', async () => {
    const r = await service(repositorio({ numeroVendas: 4, totalPagamentos: 100 })).report('TNP', '2026-08-01', '2026-08-02');

    expect(r.resumo.ticketMedio).toBe(25);
  });

  it('não apresenta fechamento parcial como total completo do período', async () => {
    const pagamentos = [{ data: '2026-10-06', total: 21871.46, numeroVendas: 1433 }] as VendasSchemas.PagamentoDia[];
    const repo = repositorio({
      faturamento: 22024.68, pagamentos,
      diasComVendas: ['2026-10-06', '2026-10-07'],
    });
    const r = await service(repo).report('TNP', '2026-10-06', '2026-10-07');

    expect(r.resumo).toMatchObject({
      origemFaturamento: 'fechamento', faturamento: 21871.46,
      valorItens: 22024.68, diferencaItensFechamento: -153.22,
      diasSemFechamento: ['2026-10-07'],
    });
    expect(r.serie).toEqual([{ t: '2026-10-06', total: 21871.46, numeroVendas: 1433 }]);
  });

  it('sem vendas o ticket médio é zero, nunca NaN nem divisão por zero', async () => {
    const r = await service(repositorio({ numeroVendas: 0, totalPagamentos: 0 })).report('TNP', '2026-08-01', '2026-08-02');

    expect(r.resumo.ticketMedio).toBe(0);
    expect(Number.isFinite(r.resumo.ticketMedio)).toBe(true);
  });

  it('menos vendidos ignora quem não vendeu nada e vem do menor para o maior', async () => {
    const repo = repositorio({ produtos: [produto('a', 10, 100), produto('b', 1, 5), produto('c', 0, 0)] });

    const r = await service(repo).report('TNP', '2026-08-01', '2026-08-02');

    expect(r.ranking.menosVendidos.map((p) => p.produtoCodigo)).toEqual(['b', 'a']);
    expect(r.ranking.maisVendidos.map((p) => p.produtoCodigo)).toEqual(['a', 'b', 'c']);
  });

  it('produto sem código entra na contagem de qualidade', async () => {
    const repo = repositorio({ produtos: [produto('', 3, 30), produto('x', 1, 10)] });

    const r = await service(repo).report('TNP', '2026-08-01', '2026-08-02');

    expect(r.qualidade).toMatchObject({ produtosSemCodigo: 1, faturamentoSemCodigo: 30 });
  });
});

describe('VendasReportService — margem entra no relatório com a cobertura', () => {
  it('sem cadastro que case, a cobertura é 0 e a margem não é inventada', async () => {
    const repo = repositorio({ produtos: [produto('999', 1, 100)] });

    const r = await new VendasReportService(repo).report('TNP', '2026-08-01', '2026-08-02');

    expect(r.margem).toMatchObject({
      faturamentoComCusto: 0, faturamentoSemCusto: 100,
      coberturaPercentual: 0, margemPercentual: 0, produtosSemVinculo: 1,
    });
  });

  it('com o produto cadastrado, a margem sai e a cobertura é 100%', async () => {
    const repo = repositorio({
      produtos: [produto('7891234000019', 2, 20)],
      cadastro: [{ id: 'p', nome: 'X', codigoBarras: '7891234000019', custo: 6, qtCad: 1 }],
    });

    const r = await new VendasReportService(repo).report('TNP', '2026-08-01', '2026-08-02');

    expect(r.margem).toMatchObject({
      faturamentoComCusto: 20, custoTotal: 12, lucroBruto: 8,
      margemPercentual: 40, coberturaPercentual: 100,
    });
  });
});
