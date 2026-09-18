/**
 * Atribui código interno sequencial aos produtos da BASE que ainda
 * não têm, propaga o mesmo código para as cópias importadas nas lojas e dá um código
 * próprio aos produtos órfãos (criados direto na loja no modelo antigo, sem base).
 * Idempotente: só preenche o que falta. Roda no start:prod (e pode rodar manualmente).
 *
 * Uso: npm run backfill:codigo
 */
import 'reflect-metadata';
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '@/db/databases';
import { ULTIMO_CODIGO_LEGADO_POR_LOJA, type LojaCodigoInterno } from '@/modules/product/codigo-interno';

type Database = typeof defaultDb;

/**
 * Executa o backfill. Recebe o `db` por parâmetro para ser testável contra um banco
 * descartável (Testcontainers). Retorna quantos foram numerados em cada etapa.
 */
export async function backfillCodigoInterno(db: Database = defaultDb): Promise<{ base: number; orfaos: number }> {
  let base = 0;
  let orfaos = 0;
  for (const loja of Object.keys(ULTIMO_CODIGO_LEGADO_POR_LOJA) as LojaCodigoInterno[]) {
    const maxRes = await db.execute(sql`
      SELECT COALESCE(MAX(CAST(codigo_interno AS INTEGER)), 0) AS max
      FROM products
      WHERE loja = ${loja} AND codigo_interno ~ '^[0-9]+$'`);
    let n = Math.max(
      Number((maxRes.rows?.[0] as { max?: number | string } | undefined)?.max ?? 0),
      ULTIMO_CODIGO_LEGADO_POR_LOJA[loja],
    );
    const semCodigo = await db.execute(sql`
      SELECT id FROM products
      WHERE loja = ${loja} AND codigo_interno IS NULL
      ORDER BY created_at ASC, id ASC`);
    const ids = (semCodigo.rows ?? []) as { id: string }[];
    for (const r of ids) {
      n += 1;
      await db.execute(sql`UPDATE products SET codigo_interno = ${String(n).padStart(5, '0')} WHERE id = ${r.id}`);
    }
    if (loja === 'BASE') base += ids.length;
    else orfaos += ids.length;
  }
  return { base, orfaos };
}

async function main() {
  const { base, orfaos } = await backfillCodigoInterno();
  console.log(`✅ Código interno: ${base} da BASE + ${orfaos} órfão(s) numerados; propagado para as lojas.`);
  process.exit(0);
}

// só roda automaticamente quando executado como script (não quando importado por um teste)
if (!process.env.VITEST) {
  /*
   * SAI COM 0 MESMO FALHANDO — mesma razão do seed: este script roda no
   * `start:prod` encadeado com `&&` antes do servidor, e numerar código interno
   * é manutenção, não é o serviço. Falhar aqui não pode custar o login da
   * empresa. Ver a nota em `seed-base.ts`.
   */
  main().catch((e) => {
    console.error('=====================================================');
    console.error('  BACKFILL DE CÓDIGO INTERNO FALHOU.');
    console.error('  A API VAI SUBIR MESMO ASSIM; rode de novo depois.');
    console.error('=====================================================');
    console.error(e);
    process.exit(0);
  });
}
