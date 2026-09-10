/**
 * O que a gravacao FARIA na planilha nova, para um produto real. So leitura.
 *
 * Uso: tsx scripts/conferir-escrita-nova.ts <codigo> [TNP|LI]
 */
import 'reflect-metadata';
import 'dotenv/config';

const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';
const letra = (i: number): string => { let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

async function main() {
  const [chave = 'PR-PTHB-HZ18', lojaArg] = process.argv.slice(2);
  const { env } = await import('@/config/env');
  const { db } = await import('@/db/databases');
  const { products } = await import('@/modules/product/product.table');
  const { eq, or } = await import('drizzle-orm');
  const { ProductRepository } = await import('@/modules/product/product.repository');
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const { mapProductToCells } = await import('@/modules/google-sheets/product-sheet.mapper');
  const { lerLeiaute, traduzirParaPlanilhaNova, colunaDoCampo } = await import('@/modules/google-sheets/leiaute-planilha-nova');

  const [achado] = await db.select({ id: products.id }).from(products)
    .where(or(eq(products.codigo, chave), eq(products.id, chave))).limit(1);
  if (!achado) throw new Error(`produto ${chave} nao encontrado`);
  const produto = await new ProductRepository().findById(achado.id);
  if (!produto) throw new Error('produto sumiu');

  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const c = new GoogleSheetsClient();
  const lido = await c.batchGetValues(NOVA, [a1(ABA, 'A3:IZ3'), a1(ABA, 'A5:IZ5')], 'FORMATTED_VALUE');
  const leiaute = lerLeiaute(
    ((lido[0] ?? [])[0] ?? []) as string[],
    ((lido[1] ?? [])[0] ?? []) as string[],
    letra,
  );

  const loja = lojaArg ?? (produto.loja === 'BASE' ? null : produto.loja);
  const cells = mapProductToCells(produto, { defaultLojas: env.GOOGLE_SHEETS_DEFAULT_LOJAS });
  const { celulas, semDestino, adiadosParaALoja } = traduzirParaPlanilhaNova(cells, leiaute, loja, letra);

  const comoTexto = (x: any) => (x?.kind === 'empty' ? '' : String(x?.value ?? ''));
  console.log('\nCONFERENCIA — nada foi gravado');
  console.log(`  planilha : ${NOVA}`);
  console.log(`  aba      : ${ABA}`);
  console.log(`  produto  : ${produto.codigo}  ${produto.nome}  (loja ${produto.loja})`);
  console.log(`  faixa    : ${loja ?? 'so as gerais (produto da BASE)'}`);
  console.log(`  coluna ID: ${colunaDoCampo(leiaute, 'ID', letra) ?? '(NAO ACHOU)'}`);
  const cheias = Object.entries(celulas).filter(([, v]) => comoTexto(v) !== '');
  console.log(`  celulas  : ${Object.keys(celulas).length} (${cheias.length} com valor)`);
  for (const [col, v] of cheias.sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]))) {
    console.log(`     ${col.padEnd(3)} <- ${JSON.stringify(comoTexto(v))}`);
  }
  console.log(`  adiados para a loja (${adiadosParaALoja.length}): ${adiadosParaALoja.slice(0, 6).join(', ')}${adiadosParaALoja.length > 6 ? '…' : ''}`);
  console.log(`  SEM DESTINO (${semDestino.length}): ${semDestino.join(', ') || '(nenhum)'}`);
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
