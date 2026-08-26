import { describe, expect, it } from 'vitest';
import { parseCreareConfigs } from './creare.config';

const validStore = {
  groupCodes: { PADARIA: '0005' }, categoryCodes: { '3': '000000003' },
  units: { UN: 'UN', KG: 'KG', G: 'UN', LT: 'LT', ML: 'UN' },
  ecfTaxCodesByGroup: { PADARIA: '01' },
  decimalPlaces: { unitPrice: 2, icmsReduction: 2, fullTaxRate: 2, fcpRate: 2, pisRate: 4, cofinsRate: 4, maximumQuantity: 3, minimumQuantity: 3 },
  barcodeField: 'automatic', lineEnding: 'CRLF', noPromotionDate: '30/12/99', iat: 'A',
  ipptByProductType: { revenda: 'T', transformacao: 'P' },
  weighableByMeasure: { UN: 'N', KG: 'S', G: 'N', LT: 'N', ML: 'N' },
  stockControlledByProductType: { revenda: 'S', transformacao: 'S' },
};

describe('configuração Criare', () => {
  it('recusa valor ausente ou JSON inválido sem devolver seu conteúdo', () => {
    expect(parseCreareConfigs('').errors).toEqual(['CREARE_STORE_CONFIG_JSON']);
    const invalid = parseCreareConfigs('{segredo');
    expect(invalid.errors).toEqual(['CREARE_STORE_CONFIG_JSON_INVALID_JSON']);
    expect(JSON.stringify(invalid)).not.toContain('segredo');
  });

  it('aceita configuração explícita por loja', () => {
    const parsed = parseCreareConfigs(JSON.stringify({ TNP: validStore }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.configs.TNP?.decimalPlaces.unitPrice).toBe(2);
  });

  it('recusa defaults operacionais incompletos', () => {
    const { iat: _iat, ...incomplete } = validStore;
    expect(parseCreareConfigs(JSON.stringify({ TNP: incomplete })).errors).toContain('CREARE_STORE_CONFIG_JSON:TNP.iat');
  });
});
