import { z } from 'zod/v4';
import type { Creare } from '@pralis/shared';

const yesNo = z.enum(['S', 'N']);
const storeConfigSchema = z.object({
  groupCodes: z.record(z.string(), z.string()),
  categoryCodes: z.record(z.string(), z.string()),
  units: z.record(z.string(), z.string()),
  // legado: o grupo comercial não determina a alíquota do ECF, que agora vem do
  // casamento no SIA. Opcional só para não invalidar configuração existente.
  ecfTaxCodesByGroup: z.record(z.string(), z.string()).optional(),
  decimalPlaces: z.object({
    unitPrice: z.union([z.literal(2), z.literal(3)]),
    icmsReduction: z.number().int().min(0).max(6),
    fullTaxRate: z.number().int().min(0).max(6),
    fcpRate: z.number().int().min(0).max(6),
    pisRate: z.number().int().min(0).max(6),
    cofinsRate: z.number().int().min(0).max(6),
    maximumQuantity: z.number().int().min(0).max(6),
    minimumQuantity: z.number().int().min(0).max(6),
  }).strict(),
  barcodeField: z.enum(['short', 'extended', 'automatic']),
  lineEnding: z.enum(['CRLF', 'LF']),
  noPromotionDate: z.string().regex(/^\d{2}\/\d{2}\/\d{2}$/),
  iat: z.enum(['A', 'T']),
  ipptByProductType: z.object({ revenda: z.enum(['P', 'T']), transformacao: z.enum(['P', 'T']) }),
  weighableByMeasure: z.object({ UN: yesNo, KG: yesNo, G: yesNo, LT: yesNo, ML: yesNo }),
  stockControlledByProductType: z.object({ revenda: yesNo, transformacao: yesNo }),
}).strict();

const allStoresSchema = z.object({
  TNP: storeConfigSchema.optional(),
  LI: storeConfigSchema.optional(),
  HORA: storeConfigSchema.optional(),
}).strict().refine((value) => Object.values(value).some(Boolean), {
  message: 'Informe ao menos uma loja.',
});

export type CreareStore = 'TNP' | 'LI' | 'HORA';
export type CreareConfigs = Partial<Record<CreareStore, Creare.CreareStoreConfig>>;

export interface ParsedCreareConfigs {
  configs: CreareConfigs;
  errors: string[];
}

/** Nunca lança nem inclui o JSON recebido no erro, pois configuração não deve vazar em logs/respostas. */
export function parseCreareConfigs(raw: string): ParsedCreareConfigs {
  if (!raw.trim()) return { configs: {}, errors: ['CREARE_STORE_CONFIG_JSON'] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { configs: {}, errors: ['CREARE_STORE_CONFIG_JSON_INVALID_JSON'] };
  }
  const parsed = allStoresSchema.safeParse(json);
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'root'))];
    return { configs: {}, errors: paths.map((path) => `CREARE_STORE_CONFIG_JSON:${path}`) };
  }
  return { configs: parsed.data as CreareConfigs, errors: [] };
}
