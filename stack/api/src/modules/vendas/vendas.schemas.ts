import { z } from 'zod/v4';

const valor = z.union([z.string(), z.number()]).transform(String);

const decimal = valor.transform((raw, ctx) => {
  const value = raw.trim();
  if (!/^-?\d+(?:[.,]\d+)?$/.test(value)) {
    ctx.addIssue({ code: 'custom', message: 'número inválido' });
    return z.NEVER;
  }
  return value.replace(',', '.');
});

const inteiro = valor.transform((raw, ctx) => {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    ctx.addIssue({ code: 'custom', message: 'inteiro inválido' });
    return z.NEVER;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    ctx.addIssue({ code: 'custom', message: 'inteiro fora do limite' });
    return z.NEVER;
  }
  return parsed;
});

const dataBr = valor.transform((raw, ctx) => {
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    ctx.addIssue({ code: 'custom', message: 'data deve estar em dd/mm/aaaa' });
    return z.NEVER;
  }
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) {
    ctx.addIssue({ code: 'custom', message: 'data inexistente' });
    return z.NEVER;
  }
  return iso;
});

const dataHora = valor.transform((raw, ctx) => {
  // normalizeRecord protege datas para o Sheets prefixando apóstrofo. No POST
  // direto esse caractere continua no JSON, então faz parte do contrato real.
  const value = raw.trim().replace(/^'/, '').replace('T', ' ');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    ctx.addIssue({ code: 'custom', message: 'data/hora deve estar em aaaa-mm-dd hh:mm:ss' });
    return z.NEVER;
  }
  const [datePart, timePart] = value.split(' ');
  const [year, month, day] = datePart!.split('-').map(Number);
  const [hour, minute, second] = timePart!.split(':').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!));
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
    || parsed.getUTCHours() !== hour
    || parsed.getUTCMinutes() !== minute
    || parsed.getUTCSeconds() !== second
  ) {
    ctx.addIssue({ code: 'custom', message: 'data/hora inválida' });
    return z.NEVER;
  }
  return value;
});

const empresa = z.enum(['TNP CENTRAL', 'LISBOA CENTRAL']);
const hash = z.string().trim().regex(/^[0-9a-f]{64}$/i).transform((v) => v.toLowerCase());
const opcionalDecimal = decimal.optional().default('0');

export const vendaProdutoInputSchema = z.object({
  DATA_VENDA: dataBr,
  PRODUTO_CODIGO: valor.transform((v) => v.trim()),
  PRODUTO: z.string().trim().min(1),
  QUANTIDADE: decimal,
  VALOR_UNITARIO: decimal,
  TOTAL: decimal,
  EMPRESA: empresa,
  ATUALIZADO_EM: dataHora,
  HASH: hash,
  // Coluna nova (31/08/2026): o robo antigo nao manda, entao e opcional.
  PRODUTO_ID_ERP: valor.transform((x) => x.trim()).optional(),
}).loose();

export const fechamentoCaixaInputSchema = z.object({
  DATA_VENDA: dataBr,
  // O PDV vem de dispositivo.DESCRICAO no Creare e PODE ser vazio: em 2025 a
  // TNP registrou 85 dias de fechamento sem dispositivo vinculado, R$ 2,2 mi.
  // Exigir 1 caractere recusava esses dias inteiros. Quem identifica a linha
  // e o par (PDV, OPERADOR) — e OPERADOR continua obrigatorio.
  PDV: z.string().trim(),
  OPERADOR: z.string().trim().min(1),
  PRIMEIRA_VENDA: dataHora,
  ULTIMA_VENDA: dataHora,
  NUMERO_VENDAS: inteiro,
  CREDIARIO: opcionalDecimal,
  CREDITO: opcionalDecimal,
  DEBITO: opcionalDecimal,
  DINHEIRO: opcionalDecimal,
  PIX: opcionalDecimal,
  VOUCHER: opcionalDecimal,
  CLIENTES: opcionalDecimal,
  COLABORADORES: opcionalDecimal,
  ALIMENTACAO: opcionalDecimal,
  ROUBO_FURTO: opcionalDecimal,
  SOCIOS: opcionalDecimal,
  SOBRA_PERDA: opcionalDecimal,
  OUTROS: opcionalDecimal,
  TOTAL_PAGAMENTO: decimal,
  EMPRESA: empresa,
  ATUALIZADO_EM: dataHora,
  HASH: hash,
}).loose();

export const importarVendasBodySchema = z.object({
  tipo: z.enum(['venda_produto_dia', 'fechamento_caixa_dia']),
  linhas: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
});

export const importarVendasResultSchema = z.object({
  recebidas: z.number().int().nonnegative(),
  inseridas: z.number().int().nonnegative(),
  atualizadas: z.number().int().nonnegative(),
  ignoradas: z.number().int().nonnegative(),
});

export type VendaProdutoInput = z.output<typeof vendaProdutoInputSchema>;
export type FechamentoCaixaInput = z.output<typeof fechamentoCaixaInputSchema>;
export type ImportarVendasBody = z.output<typeof importarVendasBodySchema>;
export type ImportarVendasResult = z.output<typeof importarVendasResultSchema>;
