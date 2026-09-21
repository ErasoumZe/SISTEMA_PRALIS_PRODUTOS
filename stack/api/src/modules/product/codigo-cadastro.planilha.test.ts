import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { SheetsGateway, SheetMeta, ValueRange } from '@/modules/google-sheets/google-sheets.client';
import { CodigoCadastroPlanilhaService, type MixConfig } from './codigo-cadastro.planilha';

const CONFIG: MixConfig = {
  GOOGLE_SHEETS_MIX_SPREADSHEET_ID: 'planilha-mix',
  GOOGLE_SHEETS_MIX_TAB: 'MIX',
  GOOGLE_SHEETS_MIX_LINHA_CABECALHO: 6,
  GOOGLE_SHEETS_MIX_LINHA_INICIAL: 11,
  GOOGLE_SHEETS_MIX_LINHA_FINAL: 15,
};

/** Cabeçalho com os títulos nas posições reais da aba, e o ruído que existe lá. */
const COLUNAS: Record<string, number> = {
  ATIVO: 5, 'DESCRIÇÃO COMPLETA': 7, IPPT: 23, DESCRIÇÃO: 12, 'COD INTERNO': 25,
  'COD CESTA': 17, MIN: 43, MAX: 44, MERCADORIAS: 66, MARCAS: 67, EMB: 68,
  QUANT: 69, 'UNID/KG': 70, SETOR: 71, 'COD BARRA 1': 73,
};

const cabecalho = () => {
  const linha: string[] = new Array(240).fill('');
  for (const [titulo, i] of Object.entries(COLUNAS)) linha[i] = titulo;
  // os mesmos títulos reaparecem nos blocos de loja, mais à direita
  linha[175] = 'MIN';
  linha[176] = 'MAX';
  linha[228] = 'MARCAS';
  return linha;
};

/**
 * Stub que serve faixas de UMA coluna, como o serviço pede, e prova que nada
 * foi escrito. A planilha MIX é a régua da numeração.
 */
class GatewayEspiao implements SheetsGateway {
  escritas: ValueRange[] = [];
  estruturais: unknown[] = [];
  falha: Error | null = null;
  pedidos: string[] = [];

  constructor(private colunas: Record<number, string[]> = {}, private cab = cabecalho()) {}

  async getSheets(): Promise<SheetMeta[]> {
    return [{ sheetId: 1, title: 'MIX', rowCount: 4451, columnCount: 248 }];
  }

  async batchGetValues(_id: string, ranges: string[]): Promise<string[][][]> {
    if (this.falha) throw this.falha;
    this.pedidos.push(...ranges);
    return ranges.map((r) => {
      if (r.includes('!6:6')) return [this.cab];
      const col = r.match(/!([A-Z]+)\d+:/)?.[1] ?? '';
      let idx = 0;
      for (const ch of col) idx = idx * 26 + (ch.charCodeAt(0) - 64);
      return (this.colunas[idx - 1] ?? []).map((v) => [v]);
    });
  }

  async batchUpdateValues(_id: string, data: ValueRange[]): Promise<void> { this.escritas.push(...data); }
  async batchUpdate(_id: string, r: unknown[]): Promise<void> { this.estruturais.push(...r); }
}

/** Monta as colunas a partir de linhas nomeadas por título. */
const planilha = (linhas: Array<Record<string, string>>) => {
  const colunas: Record<number, string[]> = {};
  for (const [titulo, idx] of Object.entries(COLUNAS)) {
    colunas[idx] = linhas.map((l) => l[titulo] ?? '');
  }
  return colunas;
};

const PRODUTO = {
  'COD INTERNO': '13072', DESCRIÇÃO: 'KITKAT 41,5G BRANCO', 'COD BARRA 1': '7891000249239',
  ATIVO: 'SIM', IPPT: 'T', MERCADORIAS: 'MER BOMBONIERI', MARCAS: 'NESTLE', EMB: 'CX',
  QUANT: '30', 'UNID/KG': 'UNID', SETOR: 'LOJA', MIN: '5', MAX: '50',
};

const servico = (linhas: Array<Record<string, string>>) => {
  const gateway = new GatewayEspiao(planilha(linhas));
  return { gateway, servico: new CodigoCadastroPlanilhaService(gateway) };
};

describe('CodigoCadastroPlanilhaService', () => {
  it('não lê nada quando a planilha não foi configurada', async () => {
    const { gateway, servico: s } = servico([]);
    const r = await s.ler({ ...CONFIG, GOOGLE_SHEETS_MIX_SPREADSHEET_ID: '' });
    expect(r.estado).toBe('sem-destino');
    expect(gateway.pedidos).toEqual([]);
  });

  it('avisa quando falta uma coluna obrigatória', async () => {
    const semCodigo = cabecalho();
    semCodigo[25] = 'OUTRA COISA';
    const s = new CodigoCadastroPlanilhaService(new GatewayEspiao({}, semCodigo));
    const r = await s.ler(CONFIG);
    expect(r.estado).toBe('sem-coluna');
    expect(r.faltando).toContain('COD INTERNO');
  });

  it('lê a linha inteira, com todos os campos do cadastro', async () => {
    const { servico: s } = servico([PRODUTO]);
    const r = await s.ler(CONFIG);
    expect(r.estado).toBe('ok');
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({
      linha: 11, codigo: '13072', nome: 'KITKAT 41,5G BRANCO', codigoBarras: '7891000249239',
      ativo: 'SIM', ippt: 'T', grupo: 'MER BOMBONIERI', marca: 'NESTLE', embalagem: 'CX',
      quantidadeEmbalagem: '30', unidade: 'UNID', setor: 'LOJA', estoqueMin: '5', estoqueMax: '50',
    });
  });

  /*
   * MIN, MAX e MARCAS aparecem de novo nos blocos de loja. Pegar a ocorrência
   * errada traria o estoque de uma loja como se fosse o do cadastro.
   */
  it('usa a primeira ocorrência do título, não a dos blocos de loja', async () => {
    const { gateway, servico: s } = servico([PRODUTO]);
    await s.ler(CONFIG);
    const colunasPedidas = gateway.pedidos.filter((p) => !p.includes('!6:6'));
    expect(colunasPedidas.some((p) => p.includes('!AR11'))).toBe(true); // MIN = índice 43
    expect(colunasPedidas.some((p) => p.includes('!FT11'))).toBe(false); // MIN do bloco = 175
  });

  it('pede uma faixa estreita por coluna, não o retângulo inteiro', async () => {
    const { gateway, servico: s } = servico([PRODUTO]);
    await s.ler(CONFIG);
    const colunas = gateway.pedidos.filter((p) => !p.includes('!6:6'));
    expect(colunas).toHaveLength(13);
    for (const faixa of colunas) expect(faixa).toMatch(/!([A-Z]+)11:\1\d+$/);
  });

  /*
   * A aba tem a numeração pré-preenchida por fórmula muito além do que já foi
   * cadastrado: 313 linhas de 13127 a 13439 com código e nenhum nome. Contá-las
   * empurrava o teto para 13439 e a cunhagem pularia 313 números livres.
   */
  it('linha com código e sem nome não levanta o teto', async () => {
    const { servico: s } = servico([
      { ...PRODUTO, 'COD INTERNO': '13126', DESCRIÇÃO: 'ULTIMO PRODUTO DE VERDADE' },
      { ...PRODUTO, 'COD INTERNO': '13127', DESCRIÇÃO: '' },
      { ...PRODUTO, 'COD INTERNO': '13439', DESCRIÇÃO: '' },
    ]);
    const r = await s.ler(CONFIG);
    expect(r.teto).toBe(13126);
    // as vazias continuam na lista: quem importa as recusa por não ter nome
    expect(r.linhas).toHaveLength(3);
  });

  it('o teto é o maior COM nome, mesmo fora de ordem', async () => {
    const { servico: s } = servico([
      { ...PRODUTO, 'COD INTERNO': '13439', DESCRIÇÃO: '' },
      { ...PRODUTO, 'COD INTERNO': '12000', DESCRIÇÃO: 'UM PRODUTO' },
      { ...PRODUTO, 'COD INTERNO': '13126', DESCRIÇÃO: 'OUTRO PRODUTO' },
      { ...PRODUTO, 'COD INTERNO': '13300', DESCRIÇÃO: '' },
    ]);
    expect((await s.ler(CONFIG)).teto).toBe(13126);
  });

  it('descarta código fora da faixa do PDV e não deixa ele virar teto', async () => {
    const { servico: s } = servico([
      PRODUTO,
      { ...PRODUTO, 'COD INTERNO': '7891000249239', DESCRIÇÃO: 'BARRAS NO LUGAR DO CODIGO' },
      { ...PRODUTO, 'COD INTERNO': '0' },
      { ...PRODUTO, 'COD INTERNO': '' },
    ]);
    const r = await s.ler(CONFIG);
    expect(r.teto).toBe(13072);
    expect(r.linhas).toHaveLength(1);
    expect(r.descartadas).toBe(3);
  });

  it('conta a linha certa da planilha mesmo pulando linhas', async () => {
    const { servico: s } = servico([
      { ...PRODUTO, 'COD INTERNO': '' },
      { ...PRODUTO, 'COD INTERNO': '13072' },
    ]);
    const r = await s.ler(CONFIG);
    expect(r.linhas[0]!.linha).toBe(12);
  });

  /*
   * Janela cheia significa que pode haver produto além dela — e teto defasado
   * faz a cunhagem colidir com código que já existe na cauda não lida.
   */
  it('avisa quando a leitura encheu a janela configurada', async () => {
    const cinco = Array.from({ length: 5 }, (_, i) => ({ ...PRODUTO, 'COD INTERNO': String(13000 + i) }));
    const { servico: s } = servico(cinco);
    expect((await s.ler(CONFIG)).truncada).toBe(true);
  });

  it('não marca truncada quando sobrou espaço na janela', async () => {
    const { servico: s } = servico([PRODUTO]);
    expect((await s.ler(CONFIG)).truncada).toBe(false);
  });

  it('deixa o custo vazio: a aba tem um por loja e o cadastro é da rede', async () => {
    const { servico: s } = servico([PRODUTO]);
    expect((await s.ler(CONFIG)).linhas[0]!.custo).toBe('');
  });

  it('NUNCA escreve na planilha MIX', async () => {
    const { gateway, servico: s } = servico([PRODUTO]);
    await s.ler(CONFIG);
    expect(gateway.escritas).toEqual([]);
    expect(gateway.estruturais).toEqual([]);
  });

  it('não derruba a chamada quando o Google recusa', async () => {
    const { gateway, servico: s } = servico([]);
    gateway.falha = new Error('403');
    const r = await s.ler(CONFIG);
    expect(r.estado).toBe('falhou');
    expect(r.linhas).toEqual([]);
  });
});
