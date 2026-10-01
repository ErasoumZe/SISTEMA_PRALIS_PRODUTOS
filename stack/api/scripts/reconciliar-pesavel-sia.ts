/**
 * Concilia Pesável da TNP pela coluna Cód. produto da BASE SIA FULL.
 * Sem --apply: apenas prévia. Nunca roda no deploy.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { env } from '@/config/env';
import { db } from '@/db/databases';
import { GoogleSheetsClient, a1 } from '@/modules/google-sheets/google-sheets.client';
import { lerPesavelSia, planejarPesavelSia } from '@/modules/creare/pesavel-sia-reconcile';

const CONFIRMACAO = 'CONCILIAR PESAVEL TNP';

async function main(): Promise<void> {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID ausente.');
  const abas = new GoogleSheetsClient();
  const meta = (await abas.getSheets(env.GOOGLE_SHEETS_SPREADSHEET_ID)).find((aba) => aba.title === 'BASE SIA FULL');
  if (!meta || meta.rowCount < 3) throw new Error('Aba BASE SIA FULL ausente ou vazia.');
  const [linhas = []] = await abas.batchGetValues(
    env.GOOGLE_SHEETS_SPREADSHEET_ID,
    [a1('BASE SIA FULL', `H2:V${meta.rowCount}`)],
    'FORMATTED_VALUE',
  );
  const fonte = lerPesavelSia(linhas);
  const consulta = await db.execute(sql`
    SELECT id, codigo_interno AS "codigoInterno", pesavel
    FROM products
    WHERE loja = 'TNP' AND status <> 'unificado'
  `);
  const plano = planejarPesavelSia(
    (consulta.rows ?? []) as Array<{ id: string; codigoInterno: string | null; pesavel: string | null }>,
    fonte.registros,
  );
  console.log(JSON.stringify({ linhasFonte: fonte.registros.size, problemasFonte: fonte.problemas.length,
    exemplosProblemas: fonte.problemas.slice(0, 20), ...plano.resumo }, null, 2));
  if (fonte.problemas.length) throw new Error('Fonte com problemas: nada gravado. Corrija e rode novamente.');

  const aplicar = process.argv.includes('--apply');
  if (!aplicar) {
    console.log(`PREVIA: nada foi gravado. Para aplicar após conferência: --apply --confirm="${CONFIRMACAO}"`);
    return;
  }
  if (!process.argv.includes(`--confirm=${CONFIRMACAO}`)) throw new Error('Confirmação explícita ausente; nada gravado.');
  await db.transaction(async (tx) => {
    for (const item of plano.atualizar) {
      // Idempotente e protege uma edição humana ocorrida entre prévia e aplicação.
      await tx.execute(sql`
        UPDATE products SET
          pesavel = ${item.fonte.pesavel},
          tecla_balanca = CASE WHEN ${item.fonte.pesavel} = 'S' THEN ${item.fonte.teclaBalanca} ELSE tecla_balanca END,
          validade_balanca = CASE WHEN ${item.fonte.pesavel} = 'S' THEN ${item.fonte.validadeBalanca} ELSE validade_balanca END
        WHERE id = ${item.id} AND loja = 'TNP' AND pesavel IS NULL
      `);
    }
  });
  console.log(`Conciliação concluída: até ${plano.atualizar.length} produto(s) antes não classificados; execute nova prévia para conferir.`);
}

main().then(() => process.exit(0)).catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : 'Erro desconhecido');
  process.exit(1);
});
