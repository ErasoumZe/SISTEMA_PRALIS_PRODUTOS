import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { VendasUnicos } from '@pralis/shared';
import { VendasUnicosService, montarCsv } from './vendas-unicos.service';
import type { VendasUnicosRepository } from './vendas-unicos.repository';

const linha = (over: Partial<VendasUnicos.ProdutoUnico> = {}): VendasUnicos.ProdutoUnico => ({
  codigo: '7891234000019', produto: 'PAO FRANCES', quantidade: 10, faturamento: 55.5,
  diasComVenda: 3, primeiraVenda: '2026-01-02', ultimaVenda: '2026-03-10', nomesDiferentes: 1,
  ...over,
});

function repositorio(produtos: VendasUnicos.ProdutoUnico[] = [], semIdErp = 0) {
  const chamadas: Array<Record<string, unknown>> = [];
  return {
    chamadas,
    repo: {
      async totais() {
        return {
          total: produtos.length,
          quantidade: produtos.reduce((s, p) => s + p.quantidade, 0),
          faturamento: produtos.reduce((s, p) => s + p.faturamento, 0),
        };
      },
      async linhasSemIdErp() { return semIdErp; },
      async listar(_l: string, _i: string, _f: string, o: Record<string, unknown>) {
        chamadas.push(o);
        return produtos;
      },
    } as unknown as VendasUnicosRepository,
  };
}

const consulta = (over: Partial<VendasUnicos.ProdutosUnicosQuery> = {}): VendasUnicos.ProdutosUnicosQuery => ({
  inicio: '2025-01-01', fim: '2026-08-26', ordenar: 'faturamento', pagina: 1, porPagina: 50, ...over,
});

describe('VendasUnicosService — período e paginação', () => {
  it('recusa período invertido', async () => {
    const { repo } = repositorio();
    await expect(new VendasUnicosService(repo).listar('TNP', consulta({ inicio: '2026-08-01', fim: '2026-01-01' })))
      .rejects.toMatchObject({ code: 'INVALID_PERIOD' });
  });

  it('aceita os 20 meses que o José pediu (01/01/2025 a 26/08/2026)', async () => {
    const { repo } = repositorio([linha()]);
    await expect(new VendasUnicosService(repo).listar('TNP', consulta())).resolves.toBeTruthy();
  });

  it('recusa período absurdo em vez de travar a consulta', async () => {
    const { repo } = repositorio();
    await expect(new VendasUnicosService(repo).listar('TNP', consulta({ inicio: '2000-01-01', fim: '2026-08-26' })))
      .rejects.toMatchObject({ code: 'PERIOD_TOO_LARGE' });
  });

  it('traduz página em offset', async () => {
    const { repo, chamadas } = repositorio([linha()]);
    await new VendasUnicosService(repo).listar('TNP', consulta({ pagina: 3, porPagina: 20 }));

    expect(chamadas[0]).toMatchObject({ limite: 20, offset: 40 });
  });

  it('busca vazia não vira filtro', async () => {
    const { repo, chamadas } = repositorio([linha()]);
    await new VendasUnicosService(repo).listar('TNP', consulta({ busca: '   ' }));

    expect(chamadas[0]!.busca).toBeUndefined();
  });

  it('a exportação pede o período INTEIRO, sem paginar', async () => {
    const { repo, chamadas } = repositorio([linha()]);
    await new VendasUnicosService(repo).todos('TNP', { inicio: '2025-01-01', fim: '2026-08-26', ordenar: 'nome' });

    expect(chamadas[0]).toMatchObject({ limite: null, offset: 0, ordenar: 'nome' });
  });

  it('devolve quantas linhas ainda não têm identidade do ERP', async () => {
    const { repo } = repositorio([linha()], 87);
    const r = await new VendasUnicosService(repo).listar('TNP', consulta());

    expect(r.linhasSemIdErp).toBe(87);
  });
});

describe('montarCsv — o Excel em português precisa abrir sem estragar', () => {
  it('começa com BOM, senão o acento quebra', () => {
    expect(montarCsv([]).startsWith('﻿')).toBe(true);
  });

  it('usa ponto e vírgula: a vírgula aqui é decimal', () => {
    const csv = montarCsv([linha()]);
    const cabecalho = csv.split('\r\n')[0]!;

    expect(cabecalho).toContain('CODIGO;PRODUTO;QUANTIDADE');
    expect(cabecalho).not.toContain(',');
  });

  it('número sai com vírgula decimal', () => {
    const csv = montarCsv([linha({ faturamento: 1234.5, quantidade: 2.25 })]);

    expect(csv).toContain(';1234,50;');
    expect(csv).toContain(';2,250;');
  });

  it('código com zero à esquerda NÃO pode virar número — o Excel comeria o zero', () => {
    const csv = montarCsv([linha({ codigo: '00145' })]);

    expect(csv).toContain('="00145"');
    expect(csv).not.toMatch(/(^|;)00145;/);
  });

  it('produto com aspas ou ponto e vírgula no nome não quebra a coluna', () => {
    const csv = montarCsv([linha({ produto: 'PAO "ESPECIAL"; GRANDE' })]);
    const linhaDados = csv.split('\r\n')[1]!;

    expect(linhaDados).toContain('"PAO ""ESPECIAL""; GRANDE"');
    // continua com 8 colunas: o ; de dentro das aspas não conta
    expect(linhaDados.split(';').length).toBeGreaterThan(1);
  });

  it('código vazio (pesável) sai como célula vazia, não como =""', () => {
    expect(montarCsv([linha({ codigo: '' })]).split('\r\n')[1]!.startsWith('"";')).toBe(true);
  });

  it('sem produtos devolve só o cabeçalho', () => {
    const linhas = montarCsv([]).replace('﻿', '').trim().split('\r\n');

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('NOMES_DIFERENTES');
  });
});
