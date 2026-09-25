import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { CargaBasePlanilhaService, COLUNAS_CARGA, type CargaConfig } from './carga-base.planilha';
import type { SheetsGateway } from '@/modules/google-sheets/google-sheets.client';

/**
 * O leitor nunca fala com o Google aqui: o dublê devolve as faixas na MESMA
 * ordem em que foram pedidas, que é exatamente o contrato de que a leitura
 * depende. Se um dia a ordem deixar de valer, é aqui que quebra — e não na
 * planilha de produção, com o dado já no campo errado.
 */

const cfg: CargaConfig = {
  GOOGLE_SHEETS_SPREADSHEET_ID: 'planilha-de-teste',
  GOOGLE_SHEETS_CARGA_TAB: '(TNP/LI) CADASTRO PRODUTOS',
  GOOGLE_SHEETS_CARGA_LINHA_CABECALHO: 5,
  GOOGLE_SHEETS_CARGA_LINHA_INICIAL: 11,
  GOOGLE_SHEETS_CARGA_LINHA_FINAL: 20,
};

const colToIndex = (col: string): number => {
  let n = 0;
  for (const c of col) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

/** Monta a linha 5 com cada título na letra em que o leitor espera achá-lo. */
const cabecalhoCerto = (troca: Partial<Record<string, string>> = {}): string[] => {
  const linha: string[] = [];
  for (const campo of Object.values(COLUNAS_CARGA)) {
    const i = colToIndex(campo.letra);
    while (linha.length <= i) linha.push('');
    linha[i] = troca[campo.letra] ?? campo.titulo;
  }
  linha[colToIndex('C')] = troca.C ?? 'V';
  return linha;
};

/** Um dublê que responde as faixas pedidas, com as colunas na ordem do leitor. */
const gateway = (cabecalho: string[], colunas: Record<string, string[]>): SheetsGateway => ({
  getSheets: vi.fn(),
  batchGetValues: vi.fn(async (_id: string, ranges: string[]) => ranges.map((range) => {
    if (/!\d+:\d+$/.test(range)) return [cabecalho];
    const letra = range.match(/!([A-Z]+)\d+:/)?.[1] ?? '';
    return (colunas[letra] ?? []).map((v) => [v]);
  })),
  batchUpdateValues: vi.fn(),
  batchUpdate: vi.fn(),
});

const duasLinhas = {
  C: ['ATIVO', 'INATIVO'],
  D: ['ABACAXI UNID', 'AÇAFRAO KG'],
  F: ['10000', '7898959762024'],
  H: ['UN', 'KG'],
  M: ['MER ⁠MAT. PRIMA - ⁠FRUTAS', ''],
  X: ['10.000', '10.001'],
  Z: ['1', ''],
  AB: ['3', ''],
  AE: ['6,5', '16,97'],
  AH: ['0,3', '145'],
  HX: ['97', '83'],
};

describe('CargaBasePlanilhaService', () => {
  it('monta cada linha com a coluna certa em cada campo', async () => {
    const leitor = new CargaBasePlanilhaService(gateway(cabecalhoCerto(), duasLinhas));
    const r = await leitor.ler(cfg);
    expect(r.estado).toBe('ok');
    expect(r.linhas).toHaveLength(2);
    expect(r.linhas[0]).toEqual({
      linha: 11,
      situacao: 'ATIVO',
      nome: 'ABACAXI UNID',
      codigoBarras: '10000',
      unidade: 'UN',
      grupo: 'MER ⁠MAT. PRIMA - ⁠FRUTAS',
      codigo: '10.000',
      estoqueMin: '1',
      estoqueMax: '3',
      custo: '6,5',
      precoVenda: '0,3',
      grupoId: '97',
    });
    expect(r.linhas[1]?.linha).toBe(12);
    expect(r.linhas[1]?.grupoId).toBe('83');
  });

  it('para tudo quando um título sai do lugar, sem devolver linha nenhuma', async () => {
    /*
     * O defeito que esta trava existe para impedir: com a coluna deslocada, o
     * custo entraria no campo de preço e o banco aceitaria calado.
     */
    const leitor = new CargaBasePlanilhaService(gateway(cabecalhoCerto({ AE: 'OUTRA COISA' }), duasLinhas));
    const r = await leitor.ler(cfg);
    expect(r.estado).toBe('coluna-mudou');
    expect(r.linhas).toEqual([]);
    expect(r.trocadas).toEqual([{ coluna: 'AE', esperado: 'CUSTO', encontrado: 'OUTRA COISA' }]);
  });

  it('não confere o título da coluna C, que é a letra solta V', async () => {
    const leitor = new CargaBasePlanilhaService(gateway(cabecalhoCerto({ C: 'qualquer coisa' }), duasLinhas));
    expect((await leitor.ler(cfg)).estado).toBe('ok');
  });

  it('ignora acento e caixa ao conferir o título', async () => {
    const leitor = new CargaBasePlanilhaService(gateway(cabecalhoCerto({ AH: 'v. venda pontual' }), duasLinhas));
    expect((await leitor.ler(cfg)).estado).toBe('ok');
  });

  it('descarta linha sem nome e conta quantas foram', async () => {
    const leitor = new CargaBasePlanilhaService(gateway(cabecalhoCerto(), {
      ...duasLinhas,
      D: ['ABACAXI UNID', '', 'PAO FRANCES KG'],
      X: ['10.000', '10.001', '10.002'],
    }));
    const r = await leitor.ler(cfg);
    expect(r.linhas.map((l) => l.nome)).toEqual(['ABACAXI UNID', 'PAO FRANCES KG']);
    expect(r.descartadas).toBe(1);
    // a linha 13 da planilha continua sendo a linha 13, mesmo com a 12 fora
    expect(r.linhas[1]?.linha).toBe(13);
  });

  it('avisa quando a janela lida encheu', async () => {
    const dez = (v: string) => Array.from({ length: 10 }, (_, i) => `${v}${i}`);
    const leitor = new CargaBasePlanilhaService(gateway(cabecalhoCerto(), {
      ...duasLinhas,
      D: dez('PRODUTO '),
      X: dez('1000'),
    }));
    expect((await leitor.ler(cfg)).truncada).toBe(true);
  });

  it('não tenta ler sem destino configurado', async () => {
    const g = gateway(cabecalhoCerto(), duasLinhas);
    const leitor = new CargaBasePlanilhaService(g);
    const r = await leitor.ler({ ...cfg, GOOGLE_SHEETS_SPREADSHEET_ID: '  ' });
    expect(r.estado).toBe('sem-destino');
    expect(g.batchGetValues).not.toHaveBeenCalled();
  });

  it('devolve o erro em vez de estourar quando o Google recusa', async () => {
    const leitor = new CargaBasePlanilhaService({
      getSheets: vi.fn(),
      batchGetValues: vi.fn(async () => { throw new Error('quota excedida'); }),
      batchUpdateValues: vi.fn(),
      batchUpdate: vi.fn(),
    });
    const r = await leitor.ler(cfg);
    expect(r.estado).toBe('falhou');
    expect(r.erro).toBe('quota excedida');
  });
});
