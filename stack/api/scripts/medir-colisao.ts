/** Quantos produtos do Pralis ja existem na planilha nova, por nome. So leitura. */
import 'reflect-metadata';
import 'dotenv/config';
const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';
const chave = (s: string) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\p{Cf}/gu, '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
async function main() {
  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const { db } = await import('@/db/databases');
  const { products } = await import('@/modules/product/product.table');
  const { eq } = await import('drizzle-orm');
  const c = new GoogleSheetsClient();

  const lido = await c.batchGetValues(NOVA, [a1(ABA, 'D11:D'), a1(ABA, 'HT11:HT')], 'FORMATTED_VALUE');
  const nomes = (lido[0] ?? []).map((r: any) => String(r?.[0] ?? '').trim()).filter(Boolean);
  const ids = (lido[1] ?? []).map((r: any) => String(r?.[0] ?? '').trim()).filter(Boolean);
  const naPlanilha = new Set(nomes.map(chave));

  const base = await db.select({ nome: products.nome }).from(products).where(eq(products.loja, 'BASE'));
  const casam = base.filter((p) => naPlanilha.has(chave(p.nome))).length;

  console.log(`  planilha nova : ${nomes.length} produtos, ${ids.length} com ID`);
  console.log(`  Pralis BASE   : ${base.length} produtos`);
  console.log(`  casam por nome: ${casam}  (${((casam / Math.max(base.length, 1)) * 100).toFixed(1)}% da base)`);
  console.log(`  virariam LINHA NOVA se a chave virasse agora: ${casam} duplicatas`);
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
