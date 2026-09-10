import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '@/config/env';
import type { ProductSchemas } from '@pralis/shared';
import type { SheetsGateway } from './google-sheets.client';
import { ProductSheetLojaService } from './product-sheet-loja.service';

const anterior = {
  id: env.GOOGLE_SHEETS_SPREADSHEET_ID,
  base: env.GOOGLE_SHEETS_BASE_TAB,
  tabs: env.GOOGLE_SHEETS_LOJA_TABS,
  auto: env.GOOGLE_SHEETS_LOJA_ESPELHO_AUTO,
};

beforeEach(() => {
  env.GOOGLE_SHEETS_SPREADSHEET_ID = 'planilha-teste';
  env.GOOGLE_SHEETS_BASE_TAB = '(BASE) CADASTRO PRODUTOS';
  env.GOOGLE_SHEETS_LOJA_TABS = '';
  env.GOOGLE_SHEETS_LOJA_ESPELHO_AUTO = false;
});
afterEach(() => {
  env.GOOGLE_SHEETS_SPREADSHEET_ID = anterior.id;
  env.GOOGLE_SHEETS_BASE_TAB = anterior.base;
  env.GOOGLE_SHEETS_LOJA_TABS = anterior.tabs;
  env.GOOGLE_SHEETS_LOJA_ESPELHO_AUTO = anterior.auto;
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

describe('espelho automático em lote', () => {
  /** Linhas tocadas por uma escrita, lidas dos ranges (ex.: "'(TNP)...'!F13"). */
  const linhasDe = (escritas: Array<{ range: string }>) =>
    [...new Set(escritas.map((e) => Number(/!.*?([0-9]+)$/.exec(e.range)?.[1])))].sort((a, b) => a - b);

  it('desligado por padrão: não escreve NADA', async () => {
    const escritas: Array<{ range: string; values: string[][] }> = [];
    const s = new ProductSheetLojaService(gateway({ escritas }));

    const r = await s.espelharVarios([produto()], 'TNP');

    expect(r).toBe('desligado');
    expect(escritas).toEqual([]);
  });

  /*
   * O caso que o lote existe para resolver. Relendo a planilha por produto, os
   * dois novos veriam a MESMA primeira linha livre e o segundo gravaria em cima
   * do primeiro — dentro da mesma importação, sem ninguém perceber.
   */
  it('dois produtos NOVOS no mesmo lote ficam em linhas diferentes', async () => {
    env.GOOGLE_SHEETS_LOJA_ESPELHO_AUTO = true;
    const escritas: Array<{ range: string; values: string[][] }> = [];
    const s = new ProductSheetLojaService(gateway({ escritas, ids: ['ja-existe'], nomes: ['OUTRO'] }));

    const r = await s.espelharVarios(
      [produto({ id: 'novo-1' }), produto({ id: 'novo-2' })],
      'TNP',
    );

    expect(r).toBe('espelhado');
    expect(linhasDe(escritas)).toEqual([12, 13]); // 11 está ocupada
  });

  /*
   * Mesma ideia, mas nos BURACOS do meio — que e onde o lote pode se atropelar
   * de verdade. A primeira versao deste teste nao pegava o bug: sem buraco
   * nenhum, todo mundo caia no fim da aba e as linhas saiam diferentes por
   * acidente.
   */
  it('dois produtos NOVOS ocupam buracos DIFERENTES do meio da aba', async () => {
    env.GOOGLE_SHEETS_LOJA_ESPELHO_AUTO = true;
    const escritas: Array<{ range: string; values: string[][] }> = [];
    const s = new ProductSheetLojaService(gateway({
      escritas,
      ids: ['a', '', '', 'd'], //   11 ocupada, 12 e 13 livres, 14 ocupada
      nomes: ['X', '', '', 'Y'],
    }));

    await s.espelharVarios([produto({ id: 'novo-1' }), produto({ id: 'novo-2' })], 'TNP');

    expect(linhasDe(escritas)).toEqual([12, 13]);
  });

  it('produto que já tem linha ATUALIZA a dele, sem consumir linha nova', async () => {
    env.GOOGLE_SHEETS_LOJA_ESPELHO_AUTO = true;
    const escritas: Array<{ range: string; values: string[][] }> = [];
    const s = new ProductSheetLojaService(gateway({
      escritas, ids: ['outro', 'uuid-do-produto'], nomes: ['X', 'ARROZ TIPO 1'],
    }));

    await s.espelharVarios([produto()], 'TNP');

    expect(linhasDe(escritas)).toEqual([12]); // a linha que já era dele
  });

  /* O produto JÁ está salvo no Postgres quando isto roda. */
  it('falha do Google vira "falhou" — nunca estoura para quem cadastrou', async () => {
    env.GOOGLE_SHEETS_LOJA_ESPELHO_AUTO = true;
    const quebrado = {
      ...gateway({}),
      batchGetValues: async () => { throw new Error('quota exceeded'); },
    } as unknown as SheetsGateway;
    const s = new ProductSheetLojaService(quebrado);

    await expect(s.espelharVarios([produto()], 'TNP')).resolves.toBe('falhou');
  });

  it('lote vazio não chama o Google', async () => {
    env.GOOGLE_SHEETS_LOJA_ESPELHO_AUTO = true;
    const escritas: Array<{ range: string; values: string[][] }> = [];
    const s = new ProductSheetLojaService(gateway({ escritas }));

    expect(await s.espelharVarios([], 'TNP')).toBe('espelhado');
    expect(escritas).toEqual([]);
  });
});

/**
 * As abas `(TNP)` e `(LI) CADASTRO PRODUTOS` sao COPIAS linha a linha da aba
 * combinada, com uma unica faixa de loja no lugar das duas. Medido na planilha
 * em 10/09/2026: das 1.188 linhas com produto, 1.187 tinham nome identico nas
 * tres abas — a unica divergente era justamente a linha que o sistema criou
 * escrevendo so na combinada.
 */
const abaDeLoja = (loja: 'TNP' | 'LI', linhaAlvo: number) => {
  const vazias = () => Array.from({ length: 14 }, () => '');
  const faixas = vazias();
  faixas[5] = 'CADASTRO GERAL';
  faixas[11] = `${loja} - CADASTRO`;
  const cabecalhos = vazias();
  cabecalhos[2] = 'V';
  cabecalhos[3] = 'CADASTRO PRODUTOS ATUALIZADO NOVO';
  cabecalhos[5] = 'CODIGO BARRAS';
  cabecalhos[6] = 'MARCAS';
  cabecalhos[7] = 'EMB';
  cabecalhos[8] = 'C/DE';
  cabecalhos[9] = 'QT';
  cabecalhos[10] = 'COMO SE COMPRA ESSE PRODUTO?';
  cabecalhos[11] = 'CODIGO INT.';
  cabecalhos[12] = 'ESTOQUE MIN';
  cabecalhos[13] = 'CUSTO';
  // duas colunas que a PROPRIA planilha calcula na linha do produto
  const linha = vazias();
  linha[8] = `=IFERROR(VLOOKUP(H${linhaAlvo};DE_PARA;2;0);"")`;
  linha[10] = `=IF(I${linhaAlvo}="";"";"1 "&H${linhaAlvo})`;
  return { faixas, cabecalhos, linha };
};

const gatewayDasAbasDeLoja = (
  escritas: Array<{ range: string; values: unknown[][] }>,
  linhaAlvo = 20,
) => {
  const abas: Record<string, ReturnType<typeof abaDeLoja>> = {
    '(TNP) CADASTRO PRODUTOS': abaDeLoja('TNP', linhaAlvo),
    '(LI) CADASTRO PRODUTOS': abaDeLoja('LI', linhaAlvo),
  };
  return {
    getSheets: async () => Object.keys(abas).map((title, i) => ({
      title, sheetId: i + 1, rowCount: 5000, columnCount: 14,
    })),
    batchGetValues: async (_id: string, faixas: string[]) => faixas.map((faixa) => {
      const titulo = Object.keys(abas).find((t) => faixa.includes(t))!;
      const aba = abas[titulo]!;
      if (/!A3:/.test(faixa)) return [aba.faixas];
      if (/!A5:/.test(faixa)) return [aba.cabecalhos];
      return [aba.linha];
    }),
    batchUpdateValues: async (
      _id: string,
      valores: Array<{ range: string; values: unknown[][] }>,
    ) => { escritas.push(...valores); },
    batchUpdate: async () => {},
  } as unknown as SheetsGateway;
};

/** O que foi escrito em UMA aba, por letra de coluna. */
const porColuna = (
  escritas: Array<{ range: string; values: unknown[][] }>,
  aba: string,
): Map<string, string> => {
  const mapa = new Map<string, string>();
  for (const e of escritas) {
    if (!e.range.includes(aba)) continue;
    const coluna = /!([A-Z]+)\d+$/.exec(e.range)?.[1];
    if (coluna) mapa.set(coluna, String(e.values[0]?.[0] ?? ''));
  }
  return mapa;
};

describe('espelharNasAbasDeLoja — as abas de loja na MESMA linha da combinada', () => {
  it('leva a faixa da loja so para a aba dela, e as gerais para as duas', async () => {
    const escritas: Array<{ range: string; values: unknown[][] }> = [];
    const s = new ProductSheetLojaService(gatewayDasAbasDeLoja(escritas));
    const li = produto({
      loja: 'LI', nome: 'TESTE ZE 2 LT', codigoInterno: '04091', estoqueMin: 11, custo: 72,
    });

    await expect(s.espelharNasAbasDeLoja([{ produto: li, linha: 20 }])).resolves.toBe('espelhado');

    const naLi = porColuna(escritas, '(LI) CADASTRO PRODUTOS');
    const naTnp = porColuna(escritas, '(TNP) CADASTRO PRODUTOS');

    expect(naLi.get('L')).toBe('04091'); // CODIGO INT. dentro de "LI - CADASTRO"
    expect(naLi.get('M')).toBe('11');
    expect(naLi.get('N')).toBe('72');
    // a aba da TNP nao pode ganhar nenhum dado de cadastro da LI
    expect(naTnp.has('L')).toBe(false);
    expect(naTnp.has('M')).toBe(false);
    expect(naTnp.has('N')).toBe(false);
    // ...mas recebe as colunas gerais, senao a linha 20 desalinha das outras
    expect(naTnp.get('D')).toBe('TESTE ZE 2 LT');
    expect(naLi.get('D')).toBe('TESTE ZE 2 LT');
  });

  it('produto da BASE alinha as duas abas sem tocar em faixa de loja', async () => {
    const escritas: Array<{ range: string; values: unknown[][] }> = [];
    const s = new ProductSheetLojaService(gatewayDasAbasDeLoja(escritas));
    const base = produto({ loja: 'BASE', nome: 'PAO FRANCES', codigoInterno: '00042', custo: 3 });

    await expect(s.espelharNasAbasDeLoja([{ produto: base, linha: 20 }])).resolves.toBe('espelhado');

    for (const aba of ['(TNP) CADASTRO PRODUTOS', '(LI) CADASTRO PRODUTOS']) {
      const escrito = porColuna(escritas, aba);
      expect(escrito.get('D')).toBe('PAO FRANCES');
      expect(escrito.has('L')).toBe(false); // CODIGO INT. e da loja, nao da BASE
      expect(escrito.has('N')).toBe(false); // CUSTO idem
    }
  });

  it('preserva as colunas que a propria planilha calcula na linha', async () => {
    const escritas: Array<{ range: string; values: unknown[][] }> = [];
    const s = new ProductSheetLojaService(gatewayDasAbasDeLoja(escritas));
    const li = produto({ loja: 'LI', embalagem: 'FD', cDe: 'DE', qtCad: 12 });

    await s.espelharNasAbasDeLoja([{ produto: li, linha: 20 }]);

    const naLi = porColuna(escritas, '(LI) CADASTRO PRODUTOS');
    expect(naLi.has('I')).toBe(false); // C/DE e VLOOKUP da propria planilha
    expect(naLi.has('K')).toBe(false); // COMO SE COMPRA idem
    expect(naLi.get('H')).toBe('FD'); // EMB, que e entrada, continua sendo gravada
  });
});
