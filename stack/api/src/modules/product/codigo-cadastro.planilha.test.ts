import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { SheetsGateway, SheetMeta, ValueRange } from '@/modules/google-sheets/google-sheets.client';
import { CodigoCadastroPlanilhaService, type MixConfig } from './codigo-cadastro.planilha';

const CONFIG: MixConfig = {
  GOOGLE_SHEETS_MIX_SPREADSHEET_ID: 'planilha-mix',
  GOOGLE_SHEETS_MIX_TAB: 'MIX PRODUTOS LOJA E PRODUÇÃO ASSOCIAÇÃO',
  GOOGLE_SHEETS_MIX_LINHA_CABECALHO: 6,
  GOOGLE_SHEETS_MIX_LINHA_INICIAL: 11,
  GOOGLE_SHEETS_MIX_LINHA_FINAL: 6000,
};

/** Cabeçalho com as três colunas nas posições reais da planilha. */
const cabecalho = () => {
  const linha: string[] = new Array(80).fill('');
  linha[12] = 'DESCRIÇÃO';
  linha[25] = 'COD INTERNO';
  linha[73] = 'COD BARRA 1';
  // ruído que existe de verdade e não pode confundir a busca
  linha[7] = 'DESCRIÇÃO COMPLETA';
  linha[17] = 'COD CESTA';
  linha[151 - 100] = 'COD INT';
  return linha;
};

/**
 * Stub mínimo: guarda o que foi pedido e prova que nada foi escrito. A planilha
 * MIX é a régua da numeração — escrever nela seria apagar a própria régua.
 */
class GatewayEspiao implements SheetsGateway {
  lidos: string[][] = [];
  escritas: ValueRange[] = [];
  estruturais: unknown[] = [];
  falha: Error | null = null;

  constructor(private dados: Record<string, string[][]> = {}) {}

  async getSheets(): Promise<SheetMeta[]> {
    return [{ sheetId: 1, title: CONFIG.GOOGLE_SHEETS_MIX_TAB, rowCount: 4451, columnCount: 248 }];
  }

  async batchGetValues(_id: string, ranges: string[]): Promise<string[][][]> {
    if (this.falha) throw this.falha;
    this.lidos.push(ranges);
    return ranges.map((r) => this.dados[r] ?? []);
  }

  async batchUpdateValues(_id: string, data: ValueRange[]): Promise<void> {
    this.escritas.push(...data);
  }

  async batchUpdate(_id: string, requests: unknown[]): Promise<void> {
    this.estruturais.push(...requests);
  }
}

/** A leitura do bloco começa em M (índice 12) e vai até BV (índice 73). */
const linhaDeDados = (nome: string, codigo: string, barras: string): string[] => {
  const bloco: string[] = new Array(62).fill('');
  bloco[0] = nome;        // M
  bloco[25 - 12] = codigo; // Z
  bloco[73 - 12] = barras; // BV
  return bloco;
};

const servico = (dados: Record<string, string[][]>) => {
  const gateway = new GatewayEspiao(dados);
  return { gateway, servico: new CodigoCadastroPlanilhaService(gateway) };
};

const RANGE_CABECALHO = `'MIX PRODUTOS LOJA E PRODUÇÃO ASSOCIAÇÃO'!A6:IV6`;
const RANGE_DADOS = `'MIX PRODUTOS LOJA E PRODUÇÃO ASSOCIAÇÃO'!M11:BV6000`;

describe('CodigoCadastroPlanilhaService', () => {
  it('não lê nada quando a planilha não foi configurada', async () => {
    const { gateway, servico: s } = servico({});
    const r = await s.ler({ ...CONFIG, GOOGLE_SHEETS_MIX_SPREADSHEET_ID: '' });
    expect(r.estado).toBe('sem-destino');
    expect(r.linhas).toEqual([]);
    expect(gateway.lidos).toEqual([]);
  });

  it('avisa quando o cabeçalho não tem a coluna do código', async () => {
    const semCodigo = cabecalho();
    semCodigo[25] = 'OUTRA COISA';
    const { servico: s } = servico({ [RANGE_CABECALHO]: [semCodigo] });
    const r = await s.ler(CONFIG);
    expect(r.estado).toBe('sem-coluna');
    expect(r.faltando).toContain('COD INTERNO');
  });

  it('lê as linhas e devolve o teto da numeração', async () => {
    const { servico: s } = servico({
      [RANGE_CABECALHO]: [cabecalho()],
      [RANGE_DADOS]: [
        linhaDeDados('KITKAT 41,5G BRANCO', '13072', '7891000249239'),
        linhaDeDados('IOGURTE ACTIVIA MORANGO 150G', '13085', '7891025102656'),
      ],
    });
    const r = await s.ler(CONFIG);
    expect(r.estado).toBe('ok');
    expect(r.teto).toBe(13085);
    expect(r.linhas).toEqual([
      { linha: 11, codigo: '13072', codigoBarras: '7891000249239', nome: 'KITKAT 41,5G BRANCO' },
      { linha: 12, codigo: '13085', codigoBarras: '7891025102656', nome: 'IOGURTE ACTIVIA MORANGO 150G' },
    ]);
  });

  it('descarta linha sem código de cadastro e conta a linha certa', async () => {
    const { servico: s } = servico({
      [RANGE_CABECALHO]: [cabecalho()],
      [RANGE_DADOS]: [
        linhaDeDados('LEGENDA QUALQUER', '', ''),
        linhaDeDados('KITKAT 41,5G BRANCO', '13072', '7891000249239'),
      ],
    });
    const r = await s.ler(CONFIG);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]!.linha).toBe(12);
    expect(r.descartadas).toBe(1);
  });

  /*
   * Um código de barras digitado na coluna do código viraria o teto da
   * numeração, e a próxima cunhagem sairia na casa dos trilhões — número que o
   * layout do Creare nem aceita.
   */
  it('descarta código fora da faixa do PDV e não deixa ele virar teto', async () => {
    const { servico: s } = servico({
      [RANGE_CABECALHO]: [cabecalho()],
      [RANGE_DADOS]: [
        linhaDeDados('KITKAT 41,5G BRANCO', '13072', '7891000249239'),
        linhaDeDados('LINHA COM BARRAS NO LUGAR DO CODIGO', '7891000249239', ''),
        linhaDeDados('LINHA COM ZERO', '0', ''),
      ],
    });
    const r = await s.ler(CONFIG);
    expect(r.teto).toBe(13072);
    expect(r.linhas).toHaveLength(1);
    expect(r.descartadas).toBe(2);
  });

  it('NUNCA escreve na planilha MIX', async () => {
    const { gateway, servico: s } = servico({
      [RANGE_CABECALHO]: [cabecalho()],
      [RANGE_DADOS]: [linhaDeDados('KITKAT 41,5G BRANCO', '13072', '7891000249239')],
    });
    await s.ler(CONFIG);
    expect(gateway.escritas).toEqual([]);
    expect(gateway.estruturais).toEqual([]);
  });

  it('não derruba a chamada quando o Google recusa', async () => {
    const { gateway, servico: s } = servico({});
    gateway.falha = new Error('403');
    const r = await s.ler(CONFIG);
    expect(r.estado).toBe('falhou');
    expect(r.linhas).toEqual([]);
  });
});
