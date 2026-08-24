import { inject, injectable } from 'tsyringe';
import { env, credenciaisSheetsFaltando, destinoSheetsFaltando } from '@/config/env';
import { AppError } from '@/config/api.replies';
import { SHEETS_GATEWAY } from '@/modules/google-sheets/google-sheets.di';
import { a1, type SheetsGateway } from '@/modules/google-sheets/google-sheets.client';

export interface GroupTaxRule {
  grupo: string;
  cstPisCofins: string;
  tributacaoSimples: string;
  aliquotaSimples: number;
  icmsRe: number;
  baseFiscal: string;
}

const CACHE_MS = 5 * 60 * 1000;

/** Remove caracteres invisíveis usados na planilha e uniformiza a comparação. */
export const normalizeGroup = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');

/** "11,28%" -> 11.28. A unidade permanece percentual, igual à tela. */
export const parseSheetPercent = (value: string): number => {
  const parsed = Number(value.replace('%', '').replace(/\./g, '').replace(',', '.').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

@injectable()
export class TaxRuleService {
  private cache: { expiresAt: number; rules: GroupTaxRule[] } | null = null;

  constructor(@inject(SHEETS_GATEWAY) private sheets: SheetsGateway) {}

  async list(): Promise<GroupTaxRule[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.rules;
    const missing = [...destinoSheetsFaltando(), ...credenciaisSheetsFaltando()];
    if (missing.length) {
      throw new AppError(`Regras fiscais indisponíveis: configuração incompleta (${missing.join(', ')}).`, 503, 'TAX_RULES_UNAVAILABLE');
    }

    const [rows] = await this.sheets.batchGetValues(
      env.GOOGLE_SHEETS_SPREADSHEET_ID,
      [a1(env.GOOGLE_SHEETS_FISCAL_TAB, 'AB4:AG79')],
      'FORMATTED_VALUE',
    );
    const unique = new Map<string, GroupTaxRule>();
    for (const row of rows ?? []) {
      const [grupo = '', cst = '', tributacao = '', aliquota = '', icms = '', base = ''] = row;
      const key = normalizeGroup(grupo);
      if (!key || !cst) continue;
      unique.set(key, {
        grupo: grupo.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim(),
        cstPisCofins: cst.trim(),
        tributacaoSimples: tributacao.trim(),
        aliquotaSimples: parseSheetPercent(aliquota),
        icmsRe: parseSheetPercent(icms),
        baseFiscal: base.trim(),
      });
    }
    const rules = [...unique.values()].sort((a, b) => a.grupo.localeCompare(b.grupo, 'pt-BR'));
    if (!rules.length) {
      throw new AppError('Nenhuma regra fiscal foi encontrada na tabela de grupos.', 503, 'TAX_RULES_EMPTY');
    }
    this.cache = { expiresAt: Date.now() + CACHE_MS, rules };
    return rules;
  }

  async requireForGroup(group: string): Promise<GroupTaxRule> {
    const key = normalizeGroup(group);
    const rule = (await this.list()).find((item) => normalizeGroup(item.grupo) === key);
    if (!rule) {
      throw new AppError(`O grupo "${group}" não possui regra fiscal cadastrada.`, 422, 'TAX_RULE_NOT_FOUND');
    }
    return rule;
  }
}
