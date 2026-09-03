import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '@/config/env';
import type { SheetsGateway } from '@/modules/google-sheets/google-sheets.client';
import { barcodeCandidates, ncmCode, normalizeGroup, parseSheetPercent, TaxRuleService } from './tax-rule.service';

const previous = {
  id: env.GOOGLE_SHEETS_SPREADSHEET_ID,
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
};

beforeEach(() => {
  env.GOOGLE_SHEETS_SPREADSHEET_ID = 'planilha-teste';
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'teste@example.iam.gserviceaccount.com';
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'chave-de-teste';
});

afterEach(() => {
  env.GOOGLE_SHEETS_SPREADSHEET_ID = previous.id;
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previous.email;
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = previous.key;
});

describe('TaxRuleService', () => {
  it('normaliza caracteres invisíveis e percentuais brasileiros', () => {
    expect(normalizeGroup(' MER \u2060BEBIDAS  -  ÁGUAS ')).toBe('MER BEBIDAS - ÁGUAS');
    expect(parseSheetPercent('11,28%')).toBe(11.28);
  });

  it('lê, limpa e encontra a regra pelo nome normalizado', async () => {
    const gateway = {
      batchGetValues: async () => [[
        ['MER \u2060FAB. PRÓPRIA - \u2060PANIFICAÇÃO', '6', 'ALÍQUOTA ZERO', '7,40%', '0,00%', 'Cesta básica'],
      ]],
    } as unknown as SheetsGateway;
    const service = new TaxRuleService(gateway);

    const rule = await service.requireForGroup('mer fab. própria - panificação');

    expect(rule).toEqual({
      grupo: 'MER FAB. PRÓPRIA - PANIFICAÇÃO',
      cstPisCofins: '6', tributacaoSimples: 'ALÍQUOTA ZERO',
      aliquotaSimples: 7.4, icmsRe: 0, baseFiscal: 'Cesta básica',
      // grupo sem margem na planilha: fica nulo e a margem e digitada na mao
      margemPadrao: null,
    });
  });

  it('recusa grupo sem regra em vez de inventar imposto', async () => {
    const gateway = { batchGetValues: async () => [[['GRUPO A', '1', 'TRIBUTADO', '11,28%', '3,69%', 'Regra']]] } as unknown as SheetsGateway;
    const service = new TaxRuleService(gateway);

    await expect(service.requireForGroup('GRUPO INEXISTENTE')).rejects.toMatchObject({
      statusCode: 422, code: 'TAX_RULE_NOT_FOUND',
    });
  });

  it('classifica EAN de balança pelo PLU e completa NCM e reforma tributária', async () => {
    expect(barcodeCandidates('2128050024901')).toEqual(['2128050024901', '12805']);
    const gateway = {
      batchGetValues: async () => [
        [['MER FAB. PRÓPRIA - CONFEITARIA', '1', 'TRIBUTADO INTEGRAL', '11,28%', '3,69%', 'Regra geral']],
        [['12805', '19059090', '1', '3,69%', 'BOLO PRALIS LIMAO']],
        [['19059090', 'Produtos de padaria', '000', '000001', '0,10%', '0,90%']],
        [['1', 'TRIBUTADO INTEGRAL', '11,28%']],
      ],
    } as unknown as SheetsGateway;

    const classification = await new TaxRuleService(gateway)
      .classify('MER FAB. PRÓPRIA - CONFEITARIA', '2128050024901');

    expect(classification).toMatchObject({
      origem: 'plu_balanca', codigoFiscal: '12805', ncm: '19059090',
      cstPisCofins: '1', cstReforma: '000', cClassTrib: '000001',
      aliquotaIbs: 0.1, aliquotaCbs: 0.9,
    });
  });
});

describe('TaxRuleService — aba fiscal encolhida (faixa de grupos fora da grade)', () => {
  /** Reproduz o Google: o lote com AB4:AG79 falha; sem ele, as outras 3 vêm. */
  function gatewayComGrupoForaDaGrade() {
    const pedidos: string[][] = [];
    return {
      pedidos,
      gateway: {
        batchGetValues: async (_id: string, ranges: string[]) => {
          pedidos.push(ranges);
          if (ranges.some((r) => r.includes('AB4:AG79'))) {
            throw new Error("Range ('(TNP) FISCAL - DE PARA PRODUTOS'!AB4:AG79) exceeds grid limits. Max columns: 26");
          }
          return [
            [['10010', '17019900', '6', '0', 'PRODUTO X']],
            [['19059090', 'Outros', '000', '000001', '0,10%', '0,90%']],
            [['1', 'TRIBUTADO INTEGRAL', '11,28%']],
          ];
        },
      } as unknown as SheetsGateway,
    };
  }

  it('não deixa a faixa quebrada derrubar as outras três tabelas', async () => {
    const { gateway, pedidos } = gatewayComGrupoForaDaGrade();
    const service = new TaxRuleService(gateway);

    await expect(service.list()).rejects.toMatchObject({ code: 'TAX_RULES_EMPTY' });

    // 1a tentativa com as 4 faixas, 2a só com as 3 que existem, 3a a das
    // margens — que e uma chamada SEPARADA justamente para nao entrar nesse
    // lote e poder falhar sozinha sem derrubar o fiscal
    expect(pedidos).toHaveLength(3);
    expect(pedidos[0]).toHaveLength(4);
    expect(pedidos[1]).toHaveLength(3);
    expect(pedidos[1]!.some((r) => r.includes('AB4:AG79'))).toBe(false);
  });

  it('o erro diz exatamente qual faixa restaurar', async () => {
    const { gateway } = gatewayComGrupoForaDaGrade();
    const service = new TaxRuleService(gateway);

    await expect(service.list()).rejects.toThrow(/AB4:AG79/);
    await expect(service.list()).rejects.toThrow(/CST PIS\/COFINS/);
  });

  it('quando nem as outras faixas leem, reporta a aba inteira como ilegível', async () => {
    const gateway = { batchGetValues: async () => { throw new Error('403 permission denied'); } } as unknown as SheetsGateway;
    const service = new TaxRuleService(gateway);

    await expect(service.list()).rejects.toMatchObject({ code: 'TAX_RULES_SOURCE_INVALID' });
  });
});

/*
 * NCM tem 8 digitos FIXOS e o zero a esquerda faz parte do codigo. O `code()`
 * usado para codigo de barras comia esse zero, e a propria planilha ja chega
 * sem ele em 77 dos 940 produtos porque o Excel trata NCM como numero.
 */
describe('NCM nao perde o zero a esquerda', () => {
  it('completa o que veio curto ate 8 digitos', () => {
    expect(ncmCode('4051000')).toBe('04051000');
    expect(ncmCode('4061090')).toBe('04061090');
    expect(ncmCode('123')).toBe('00000123');
  });

  it('deixa intacto o que ja tem 8 digitos', () => {
    expect(ncmCode('19059090')).toBe('19059090');
    expect(ncmCode('04051000')).toBe('04051000');
  });

  it('NAO inventa nada em vazio nem corta o que tem mais de 8', () => {
    expect(ncmCode('')).toBe('');
    expect(ncmCode('   ')).toBe('');
    expect(ncmCode('123456789')).toBe('123456789');
  });

  it('tira pontuacao antes de completar', () => {
    expect(ncmCode('0405.10.00')).toBe('04051000');
    expect(ncmCode('405.10.00')).toBe('04051000');
  });

  it('o produto sai com o NCM completo e a reforma continua casando', async () => {
    const gateway = {
      batchGetValues: async () => [
        [['GRUPO A', '1', 'TRIBUTADO', '11,28%', '3,69%', 'Regra']],
        [['10220', '4051000', '6', '0,00%', 'MANTEIGA C/SAL UBARI 500G']],
        [['4051000', '', '200', 'classe-x', '0,10%', '0,90%']],
        [],
      ],
    } as unknown as SheetsGateway;
    const service = new TaxRuleService(gateway);

    const c = await service.classify('GRUPO A', '10220');

    expect(c.ncm).toBe('04051000');
    // a reforma e indexada pelo MESMO normalizador, entao o casamento sobrevive
    expect(c.cstReforma).toBe('200');
    expect(c.cClassTrib).toBe('classe-x');
  });
});

/**
 * Margem padrao por grupo, da aba de grupos oficiais (coluna M = grupo,
 * N = margem, guardada como FRACAO: 0,2 = 20%).
 *
 * Hoje so 3 dos 76 grupos tem margem. Os outros continuam sendo digitados a
 * mao, que e o comportamento de sempre.
 */
describe('margem padrao do grupo', () => {
  /** 1a chamada: as 4 faixas fiscais. 2a: a das margens. */
  const gatewayCom = (margens: string[][]) => ({
    batchGetValues: async (_id: string, faixas: string[]) => (
      faixas.some((r) => r.includes('M5:N130'))
        ? [margens]
        : [
          [['MER CIGARROS - TRADICIONAIS', '1', 'TRIBUTADO', '11,28%', '3,69%', 'Regra']],
          [], [], [],
        ]
    ),
  }) as unknown as SheetsGateway;

  it('aplica a margem ao grupo que existe na tabela fiscal', async () => {
    const service = new TaxRuleService(gatewayCom([['MER CIGARROS - TRADICIONAIS', '0,2']]));

    const regra = await service.requireForGroup('MER CIGARROS - TRADICIONAIS');

    expect(regra.margemPadrao).toBe(0.2); // fracao: 20%
  });

  it('grupo SEM margem na planilha fica nulo, nao zero', async () => {
    const service = new TaxRuleService(gatewayCom([['MER CIGARROS - TRADICIONAIS', '']]));

    expect((await service.requireForGroup('MER CIGARROS - TRADICIONAIS')).margemPadrao).toBeNull();
  });

  it('margem de grupo que NAO existe no fiscal e ignorada', async () => {
    const service = new TaxRuleService(gatewayCom([['GRUPO QUE NAO EXISTE', '0,5']]));

    const regras = await service.list();
    expect(regras).toHaveLength(1);
    expect(regras[0]!.margemPadrao).toBeNull();
  });

  /*
   * Margem acima de 500% nao existe no varejo — e sinal de coluna lida errada.
   * Recusar em silencio e melhor que preencher o cadastro com preco absurdo.
   */
  it('recusa valor absurdo em vez de aceitar coluna errada', async () => {
    const service = new TaxRuleService(gatewayCom([['MER CIGARROS - TRADICIONAIS', '6']]));

    expect((await service.requireForGroup('MER CIGARROS - TRADICIONAIS')).margemPadrao).toBeNull();
  });

  it('aceita margem escrita com % , convertendo para fracao', async () => {
    const service = new TaxRuleService(gatewayCom([['MER CIGARROS - TRADICIONAIS', '30%']]));

    expect((await service.requireForGroup('MER CIGARROS - TRADICIONAIS')).margemPadrao).toBe(0.3);
  });

  /* A margem e conveniencia; a regra fiscal e o que impede cadastro errado. */
  it('aba de margens quebrada NAO derruba as regras fiscais', async () => {
    const gateway = {
      batchGetValues: async (_id: string, faixas: string[]) => {
        if (faixas.some((r) => r.includes('M5:N130'))) throw new Error('aba fora da grade');
        return [[['MER CIGARROS - TRADICIONAIS', '1', 'TRIBUTADO', '11,28%', '3,69%', 'Regra']], [], [], []];
      },
    } as unknown as SheetsGateway;

    const regras = await new TaxRuleService(gateway).list();

    expect(regras).toHaveLength(1);
    expect(regras[0]!.margemPadrao).toBeNull();
  });
});
