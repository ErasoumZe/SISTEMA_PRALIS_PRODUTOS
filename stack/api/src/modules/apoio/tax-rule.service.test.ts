import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '@/config/env';
import type { SheetsGateway } from '@/modules/google-sheets/google-sheets.client';
import { normalizeGroup, parseSheetPercent, TaxRuleService } from './tax-rule.service';

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
    });
  });

  it('recusa grupo sem regra em vez de inventar imposto', async () => {
    const gateway = { batchGetValues: async () => [[['GRUPO A', '1', 'TRIBUTADO', '11,28%', '3,69%', 'Regra']]] } as unknown as SheetsGateway;
    const service = new TaxRuleService(gateway);

    await expect(service.requireForGroup('GRUPO INEXISTENTE')).rejects.toMatchObject({
      statusCode: 422, code: 'TAX_RULE_NOT_FOUND',
    });
  });
});
