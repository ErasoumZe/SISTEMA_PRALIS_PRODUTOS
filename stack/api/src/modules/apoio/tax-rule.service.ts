import { inject, injectable } from 'tsyringe';
import { env, credenciaisSheetsFaltando, destinoSheetsFaltando } from '@/config/env';
import { AppError } from '@/config/api.replies';
import { SHEETS_GATEWAY } from '@/modules/google-sheets/google-sheets.di';
import { a1, type SheetsGateway } from '@/modules/google-sheets/google-sheets.client';

export interface GroupTaxRule { grupo: string; cstPisCofins: string; tributacaoSimples: string; aliquotaSimples: number; icmsRe: number; baseFiscal: string }
export interface FiscalClassification extends GroupTaxRule {
  ncm: string | null; codigoFiscal: string | null; produtoFiscal: string | null;
  cstReforma: string | null; cClassTrib: string | null; aliquotaIbs: number | null; aliquotaCbs: number | null;
  origem: 'produto' | 'plu_balanca' | 'grupo';
}
interface ProductTaxRule { codigo: string; ncm: string; cst: string; icmsRe: number; nome: string }
interface ReformRule { cst: string; cClassTrib: string; ibs: number; cbs: number }
interface Cache { expiresAt: number; groups: GroupTaxRule[]; products: Map<string, ProductTaxRule>; reform: Map<string, ReformRule>; cst: Map<string, { tributacao: string; aliquota: number }> }
const CACHE_MS = 5 * 60 * 1000;

export const normalizeGroup = (value: string): string => value.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
export const parseSheetPercent = (value: string): number => { const parsed = Number(value.replace('%', '').replace(/\./g, '').replace(',', '.').trim()); return Number.isFinite(parsed) ? parsed : 0; };
const code = (value: string) => value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/**
 * NCM tem 8 dígitos FIXOS, e o zero à esquerda faz parte do código.
 *
 * O `code()` acima serve para código de barras, onde zero à esquerda é ruído —
 * e é exatamente por isso que não serve aqui: ele transformava `04051000` em
 * `4051000`. A planilha também já chega assim em 77 dos 940 produtos, porque o
 * Excel trata NCM como número e come o zero.
 *
 * Só completa o que é curto: 8 dígitos passa intacto, e nada que tenha mais de
 * 8 ou que esteja vazio é inventado.
 */
export const ncmCode = (value: string): string => {
  const digitos = String(value ?? '').replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.length < 8 ? digitos.padStart(8, '0') : digitos;
};
export const barcodeCandidates = (barcode: string | null | undefined): string[] => {
  const digits = (barcode ?? '').replace(/\D/g, ''); const out = new Set<string>();
  if (digits) out.add(code(digits));
  if (digits.length === 13 && digits.startsWith('2')) out.add(code(digits.slice(1, 6)));
  return [...out];
};

@injectable()
export class TaxRuleService {
  private cache: Cache | null = null;
  constructor(@inject(SHEETS_GATEWAY) private sheets: SheetsGateway) {}

  private async load(): Promise<Cache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    const missing = [...destinoSheetsFaltando(), ...credenciaisSheetsFaltando()];
    if (missing.length) throw new AppError(`Regras fiscais indisponíveis: configuração incompleta (${missing.join(', ')}).`, 503, 'TAX_RULES_UNAVAILABLE');
    const FAIXA_GRUPOS = 'AB4:AG79';
    const demais = ['A4:E2000', 'H4:M200', 'O4:Q20'].map((r) => a1(env.GOOGLE_SHEETS_FISCAL_TAB, r));
    let ranges: string[][][];
    try {
      ranges = await this.sheets.batchGetValues(
        env.GOOGLE_SHEETS_SPREADSHEET_ID,
        [a1(env.GOOGLE_SHEETS_FISCAL_TAB, FAIXA_GRUPOS), ...demais],
        'FORMATTED_VALUE',
      );
    } catch {
      // UMA faixa fora da grade derruba o LOTE inteiro — e levava junto as três
      // tabelas que continuam existindo. Relê sem a faixa de grupos: se o resto
      // vier, o problema é só ela, e o erro abaixo diz exatamente qual.
      const semGrupos = await this.sheets
        .batchGetValues(env.GOOGLE_SHEETS_SPREADSHEET_ID, demais, 'FORMATTED_VALUE')
        .catch(() => null);
      if (!semGrupos) {
        // Não expõe o erro bruto do Google (traz URL e IDs internos).
        throw new AppError(
          `Não foi possível ler a aba fiscal "${env.GOOGLE_SHEETS_FISCAL_TAB}".`,
          503,
          'TAX_RULES_SOURCE_INVALID',
        );
      }
      ranges = [[], ...semGrupos];
    }
    const [groupRows = [], productRows = [], reformRows = [], cstRows = []] = ranges;
    const unique = new Map<string, GroupTaxRule>();
    for (const row of groupRows ?? []) {
      const [grupo = '', cst = '', tributacao = '', aliquota = '', icms = '', base = ''] = row; const key = normalizeGroup(grupo);
      if (key && cst) unique.set(key, { grupo: grupo.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim(), cstPisCofins: cst.trim(), tributacaoSimples: tributacao.trim(), aliquotaSimples: parseSheetPercent(aliquota), icmsRe: parseSheetPercent(icms), baseFiscal: base.trim() });
    }
    const products = new Map<string, ProductTaxRule>();
    for (const [codigo = '', ncm = '', cst = '', icms = '', nome = ''] of productRows ?? []) if (code(codigo) && ncm) products.set(code(codigo), { codigo: code(codigo), ncm: ncmCode(ncm), cst: cst.trim(), icmsRe: parseSheetPercent(icms), nome: nome.trim() });
    const reform = new Map<string, ReformRule>();
    for (const [ncm = '', , cst = '', classe = '', ibs = '', cbs = ''] of reformRows ?? []) if (ncmCode(ncm)) reform.set(ncmCode(ncm), { cst: cst.trim(), cClassTrib: classe.trim(), ibs: parseSheetPercent(ibs), cbs: parseSheetPercent(cbs) });
    const cstMap = new Map<string, { tributacao: string; aliquota: number }>();
    for (const [cst = '', tributacao = '', aliquota = ''] of cstRows ?? []) if (cst) cstMap.set(cst.trim(), { tributacao: tributacao.trim(), aliquota: parseSheetPercent(aliquota) });
    const groups = [...unique.values()].sort((a, b) => a.grupo.localeCompare(b.grupo, 'pt-BR'));
    if (!groups.length) {
      throw new AppError(
        `A tabela de regras por grupo não foi encontrada em "${env.GOOGLE_SHEETS_FISCAL_TAB}"!${FAIXA_GRUPOS}. ` +
        'Restaure nessa faixa as colunas grupo, CST PIS/COFINS, tributação (Simples), alíquota, % ICMS RE e base fiscal.',
        503,
        'TAX_RULES_EMPTY',
      );
    }
    this.cache = { expiresAt: Date.now() + CACHE_MS, groups, products, reform, cst: cstMap }; return this.cache;
  }

  async list(): Promise<GroupTaxRule[]> { return (await this.load()).groups; }
  async requireForGroup(group: string): Promise<GroupTaxRule> { const rule = (await this.list()).find((item) => normalizeGroup(item.grupo) === normalizeGroup(group)); if (!rule) throw new AppError(`O grupo "${group}" não possui regra fiscal cadastrada.`, 422, 'TAX_RULE_NOT_FOUND'); return rule; }
  async classify(group: string, barcode?: string | null): Promise<FiscalClassification> {
    const cache = await this.load(); const groupRule = await this.requireForGroup(group); const candidates = barcodeCandidates(barcode);
    const matchIndex = candidates.findIndex((candidate) => cache.products.has(candidate)); const product = matchIndex >= 0 ? cache.products.get(candidates[matchIndex]!)! : null;
    const cst = product?.cst || groupRule.cstPisCofins; const cstRule = cache.cst.get(cst); const reform = product?.ncm ? cache.reform.get(product.ncm) : null;
    return { ...groupRule, cstPisCofins: cst, icmsRe: product?.icmsRe ?? groupRule.icmsRe, tributacaoSimples: cstRule?.tributacao || groupRule.tributacaoSimples, aliquotaSimples: cstRule?.aliquota ?? groupRule.aliquotaSimples, ncm: product?.ncm ?? null, codigoFiscal: product?.codigo ?? null, produtoFiscal: product?.nome ?? null, cstReforma: reform?.cst || null, cClassTrib: reform?.cClassTrib || null, aliquotaIbs: reform?.ibs ?? null, aliquotaCbs: reform?.cbs ?? null, origem: product ? (matchIndex === 0 ? 'produto' : 'plu_balanca') : 'grupo' };
  }
}
