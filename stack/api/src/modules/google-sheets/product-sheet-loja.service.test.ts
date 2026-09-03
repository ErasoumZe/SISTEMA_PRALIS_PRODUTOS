import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '@/config/env';
import type { ProductSchemas } from '@pralis/shared';
import type { SheetsGateway } from './google-sheets.client';
import { ProductSheetLojaService } from './product-sheet-loja.service';

const anterior = { id: env.GOOGLE_SHEETS_SPREADSHEET_ID, base: env.GOOGLE_SHEETS_BASE_TAB, tabs: env.GOOGLE_SHEETS_LOJA_TABS };

beforeEach(() => {
  env.GOOGLE_SHEETS_SPREADSHEET_ID = 'planilha-teste';
  env.GOOGLE_SHEETS_BASE_TAB = '(BASE) CADASTRO PRODUTOS';
  env.GOOGLE_SHEETS_LOJA_TABS = '';
});
afterEach(() => {
  env.GOOGLE_SHEETS_SPREADSHEET_ID = anterior.id;
  env.GOOGLE_SHEETS_BASE_TAB = anterior.base;
  env.GOOGLE_SHEETS_LOJA_TABS = anterior.tabs;
});

const produto = (over: Partial<ProductSchemas.ProductEntity> = {}) => ({
  id: 'uuid-do-produto', codigo: 'PR-1', loja: 'TNP', baseProductId: null, createdByName: null,
  createdAt: '', nome: 'ARROZ TIPO 1', quantidade: 5, medidaBase: 'KG', codigoBarras: '7891000100103',
  marca: null, embalagem: null, cDe: null, qtCad: 1, medidaCompra: null, codigoInterno: '00042',
  fotoUrl: null, grupo: 'MERCEARIA', tipo: 'revenda', status: 'ativo', habilitarAjuda: false,
  estoqueMin: null, estoqueMax: null, setorEstoque: null, setorVenda1: null, setorVenda2: null,
  custo: 1, margemPontual: null, vVendaPontual: 2, auto: false, localVenda1: null, localVenda2: null,
  promocoes: [], transformacao: null, fiscal: null, ...over,
}) as unknown as ProductSchemas.ProductEntity;

/**
 * Gateway de mentira. A BASE tem NOME em E; a aba da loja tem NOME e ID em
 * posições DIFERENTES — que é o caso real: das 62 colunas em comum, 61 estão
 * deslocadas.
 */
const gateway = (opcoes: {
  cabecalhoLoja?: string[];
  ids?: string[];
  nomes?: string[];
  /** Conteudo por LETRA de coluna, para reproduzir linha ocupada so por coluna antiga. */
  colunas?: Record<string, string[]>;
  escritas?: Array<{ range: string; values: string[][] }>;
}) => {
  const cabBase = ['', '', 'A/I', 'LOJAS', 'NOME', 'QUANTIDADE', 'MEDIDA BASE'];
  const cabLoja = opcoes.cabecalhoLoja ?? ['', '', 'A/I', 'MEDIDA BASE', 'QUANTIDADE', 'NOME', 'ID'];
  return {
    getSheets: async () => [{ title: '(TNP) CADASTRO PRODUTOS', sheetId: 1, rowCount: 5000 }],
    batchGetValues: async (_id: string, faixas: string[]) => faixas.map((faixa) => {
      if (faixa.includes('(BASE)')) return [cabBase];
      if (/A5:GZ5/.test(faixa)) return [cabLoja];
      /*
       * Colunas de identidade: o servico le o ID e TODAS as colunas de ocupacao
       * que a aba tiver. O mock responde pela LETRA pedida, nao por uma faixa
       * fixa — foi assim que a conferencia real pegou o espelho querendo gravar
       * em cima de linha ocupada.
       */
      const coluna = /!([A-Z]+)11:/.exec(faixa)?.[1];
      if (coluna) {
        const dados = opcoes.colunas?.[coluna]
          ?? (coluna === 'G' ? (opcoes.ids ?? []) : (opcoes.nomes ?? []));
        return dados.map((v) => [v]);
      }
      return [];
    }),
    batchUpdateValues: async (_id: string, valores: Array<{ range: string; values: string[][] }>) => {
      opcoes.escritas?.push(...valores);
    },
    batchUpdate: async () => {},
  } as unknown as SheetsGateway;
};

describe('(a) tradução de coluna por nome', () => {
  it('leva cada campo para a coluna de mesmo cabeçalho, não da mesma posição', async () => {
    const s = new ProductSheetLojaService(gateway({}));

    const plano = await s.previsualizar(produto(), 'TNP');
    const porColuna = Object.fromEntries(plano.celulas.map((c) => [c.coluna, c.valor]));

    // NOME está em E na BASE e em F na loja; MEDIDA BASE em G e em D
    expect(porColuna.F).toBe('ARROZ TIPO 1');
    expect(porColuna.D).toBe('KG');
  });

  it('campo que a aba da loja não tem NÃO é gravado, e fica listado', async () => {
    const s = new ProductSheetLojaService(gateway({}));

    const plano = await s.previsualizar(produto(), 'TNP');

    expect(plano.semCorrespondencia).toContain('LOJAS'); // a aba de loja não tem
    expect(plano.celulas.every((c) => c.valor !== 'TNP,LI,HORA')).toBe(true);
  });
});

describe('(b) update quando o ID já está na aba', () => {
  it('reaproveita a linha do próprio produto, sem criar outra', async () => {
    const s = new ProductSheetLojaService(gateway({
      ids: ['outro', 'uuid-do-produto', 'mais-outro'],
      nomes: ['X', 'ARROZ TIPO 1', 'Y'],
    }));

    const plano = await s.previsualizar(produto(), 'TNP');

    expect(plano.linha).toBe(12); // 11 + índice 1
    expect(plano.novaLinha).toBe(false);
  });

  it('acha pelo ID mesmo se o nome na planilha estiver diferente', async () => {
    const s = new ProductSheetLojaService(gateway({
      ids: ['uuid-do-produto'],
      nomes: ['NOME ANTIGO QUE ALGUEM EDITOU'],
    }));

    expect((await s.previsualizar(produto(), 'TNP')).linha).toBe(11);
  });
});

describe('(c) reserva de linha nova quando o ID não está lá', () => {
  it('pega a primeira linha com NOME e ID vazios', async () => {
    const s = new ProductSheetLojaService(gateway({
      ids: ['a', '', 'c'],
      nomes: ['X', '', 'Y'],
    }));

    const plano = await s.previsualizar(produto(), 'TNP');

    expect(plano).toMatchObject({ linha: 12, novaLinha: true });
  });

  it('vai para o fim quando não há buraco', async () => {
    const s = new ProductSheetLojaService(gateway({ ids: ['a', 'b'], nomes: ['X', 'Y'] }));

    expect((await s.previsualizar(produto(), 'TNP')).linha).toBe(13);
  });

  /*
   * O erro que a conferência real pegou em 03/09/2026, antes de qualquer
   * escrita: `ID` e `NOME` acabaram de ser criados e estão vazios em TODAS as
   * linhas que a loja já tinha. Olhando só para eles, a linha 11 parecia livre
   * e o espelho gravaria em cima de uma linha com código de barras e código
   * interno preenchidos.
   */
  it('NÃO toma linha ocupada só pelas colunas antigas (ID e NOME ainda vazios)', async () => {
    // aba no formato real: D=CADASTRO..., F=CODIGO BARRAS, G=ID, H=NOME
    const comoNaLoja = ['', '', '', 'CADASTRO PRODUTOS ATUALIZADO NOVO', '', 'CODIGO BARRAS', 'ID', 'NOME'];
    const s = new ProductSheetLojaService(gateway({
      cabecalhoLoja: comoNaLoja,
      colunas: {
        G: ['', '', ''], // ID: coluna nova, vazia em tudo
        H: ['', '', ''], // NOME: idem
        D: ['TESTE', 'FARINHA DE TRIGO', ''],
        F: ['1234', '6987', ''],
      },
    }));

    const plano = await s.previsualizar(produto(), 'TNP');

    expect(plano.linha).toBe(13); // 11 e 12 estão ocupadas; a livre é a 13
    expect(plano.novaLinha).toBe(true);
  });

  /* Linha com nome mas sem ID é de alguém: tomar seria sobrescrever cadastro. */
  it('NÃO toma linha que tem nome mas está sem ID', async () => {
    const s = new ProductSheetLojaService(gateway({ ids: ['', ''], nomes: ['PRODUTO ALHEIO', ''] }));

    expect((await s.previsualizar(produto(), 'TNP')).linha).toBe(12);
  });
});

describe('(d) recusa aba sem ID', () => {
  it('sem coluna ID, recusa em vez de gravar', async () => {
    const semId = ['', '', 'A/I', 'MEDIDA BASE', 'QUANTIDADE', 'NOME'];
    const s = new ProductSheetLojaService(gateway({ cabecalhoLoja: semId }));

    await expect(s.previsualizar(produto(), 'TNP')).rejects.toMatchObject({ code: 'SHEET_LOJA_SEM_ID' });
  });

  it('a mensagem diz o porquê — o espelho duplicaria a cada sincronismo', async () => {
    const s = new ProductSheetLojaService(gateway({ cabecalhoLoja: ['', '', 'NOME'] }));

    await expect(s.previsualizar(produto(), 'TNP')).rejects.toThrow(/linha nova a cada sincronismo/);
  });
});

describe('quais lojas são espelhadas', () => {
  it('TNP e LI têm aba; HORA fica de fora', () => {
    const s = new ProductSheetLojaService(gateway({}));

    expect(s.abaDaLoja('TNP')).toBe('(TNP) CADASTRO PRODUTOS');
    expect(s.abaDaLoja('LI')).toBe('(LI) CADASTRO PRODUTOS');
    expect(s.abaDaLoja('HORA')).toBeNull();
    expect(s.abaDaLoja('BASE')).toBeNull();
  });

  it('configuração inválida desliga em vez de escrever no lugar errado', () => {
    env.GOOGLE_SHEETS_LOJA_TABS = '{isso nao e json';
    const s = new ProductSheetLojaService(gateway({}));

    expect(s.abaDaLoja('TNP')).toBeNull();
  });

  it('aba vazia na configuração desliga aquela loja', () => {
    env.GOOGLE_SHEETS_LOJA_TABS = JSON.stringify({ TNP: '(TNP) CADASTRO PRODUTOS', LI: '' });
    const s = new ProductSheetLojaService(gateway({}));

    expect(s.abaDaLoja('TNP')).toBe('(TNP) CADASTRO PRODUTOS');
    expect(s.abaDaLoja('LI')).toBeNull();
  });
});

describe('conferência não grava', () => {
  it('previsualizar não faz nenhuma escrita', async () => {
    const escritas: Array<{ range: string; values: string[][] }> = [];
    const s = new ProductSheetLojaService(gateway({ escritas }));

    await s.previsualizar(produto(), 'TNP');

    expect(escritas).toEqual([]);
  });

  it('espelhar grava — e reserva o ID antes do resto', async () => {
    const escritas: Array<{ range: string; values: string[][] }> = [];
    const s = new ProductSheetLojaService(gateway({ escritas }));

    await s.espelhar(produto(), 'TNP');

    expect(escritas.length).toBeGreaterThan(0);
    expect(escritas[0]!.values[0]![0]).toBe('uuid-do-produto'); // a reserva vem primeiro
  });
});
