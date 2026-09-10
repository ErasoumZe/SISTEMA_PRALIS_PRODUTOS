/**
 * Ensaio da gravação na planilha NOVA pelo caminho REAL do serviço.
 *
 * Lê de verdade (leiaute, faixas, coluna de ID, linha-modelo) e INTERCEPTA
 * toda escrita. É diferente da conferência anterior: aquela testava só o
 * tradutor; esta passa pela detecção de leiaute, pela busca da linha e pela
 * validação das fórmulas — que é onde os erros silenciosos moram.
 *
 * Uso: tsx scripts/ensaio-escrita-nova.ts <codigo>
 */
import 'reflect-metadata';
import 'dotenv/config';

const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';

async function main() {
  const [chave = 'PR-YH6C-EL27'] = process.argv.slice(2);

  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  env.GOOGLE_SHEETS_BASE_TAB = ABA;
  env.GOOGLE_SHEETS_ENABLED = true;

  const { db } = await import('@/db/databases');
  const { products } = await import('@/modules/product/product.table');
  const { eq, or } = await import('drizzle-orm');
  const { ProductRepository } = await import('@/modules/product/product.repository');
  const { ProductSheetRepository } = await import('@/modules/google-sheets/product-sheet.repository');
  const { ProductSheetService } = await import('@/modules/google-sheets/product-sheet.service');
  const { GoogleSheetsClient } = await import('@/modules/google-sheets/google-sheets.client');

  const [achado] = await db.select({ id: products.id }).from(products)
    .where(or(eq(products.codigo, chave), eq(products.id, chave))).limit(1);
  if (!achado) throw new Error(`produto ${chave} nao encontrado`);

  const real = new GoogleSheetsClient();
  const escritas: Array<{ tipo: string; detalhe: string }> = [];

  /** Deixa passar leitura; guarda escrita em vez de executar. */
  const gateway = {
    getSheets: (id: string) => real.getSheets(id),
    batchGetValues: (id: string, faixas: string[], render?: unknown) =>
      real.batchGetValues(id, faixas, render as never),
    batchUpdateValues: async (_id: string, valores: Array<{ range: string; values: unknown[][] }>, modo?: string) => {
      for (const v of valores) {
        escritas.push({ tipo: modo ?? 'RAW', detalhe: `${v.range} = ${JSON.stringify(v.values?.[0]?.[0] ?? '')}` });
      }
    },
    batchUpdate: async (_id: string, pedidos: unknown[]) => {
      for (const p of pedidos) escritas.push({ tipo: 'ESTRUTURA', detalhe: Object.keys(p as object).join(',') });
    },
  };

  const servico = new ProductSheetService(
    new ProductRepository(), new ProductSheetRepository(), gateway as never,
  );

  const produto = await new ProductRepository().findById(achado.id);
  console.log(`\nENSAIO — nenhuma escrita foi executada`);
  console.log(`  planilha: ${NOVA}`);
  console.log(`  aba     : ${ABA}`);
  console.log(`  produto : ${produto!.codigo}  ${produto!.nome}  (loja ${produto!.loja})`);

  const r = await servico.syncProduct(achado.id);
  console.log(`\n  resultado: ${r.outcome}  linha ${r.rowNumber ?? '-'}`);
  console.log(`  mensagem : ${r.message}`);
  if (r.error) console.log(`  erro     : ${r.error}`);

  console.log(`\n  escritas que teriam acontecido (${escritas.length}):`);
  for (const e of escritas.slice(0, 60)) console.log(`     [${e.tipo.padEnd(12)}] ${e.detalhe}`);
  if (escritas.length > 60) console.log(`     … e mais ${escritas.length - 60}`);
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
