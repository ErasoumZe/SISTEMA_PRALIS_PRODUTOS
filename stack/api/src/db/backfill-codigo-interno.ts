/**
 * Atribui o código interno sequencial (00001, 00002...) aos produtos da BASE que ainda
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

type Database = typeof defaultDb;

/**
 * Executa o backfill. Recebe o `db` por parâmetro para ser testável contra um banco
 * descartável (Testcontainers). Retorna quantos foram numerados em cada etapa.
 */
export async function backfillCodigoInterno(db: Database = defaultDb): Promise<{ base: number; orfaos: number }> {
  // continua a numeração a partir do maior já atribuído (qualquer produto)
  const maxRes = await db.execute(
    sql`SELECT COALESCE(MAX(CAST(codigo_interno AS INTEGER)), 0) AS max FROM products WHERE codigo_interno ~ '^[0-9]+$'`,
  );
  let n = Number((maxRes.rows?.[0] as { max?: number | string } | undefined)?.max ?? 0);

  // 1) BASE sem código, em ordem de criação (mais antigo primeiro)
  const baseSem = await db.execute(
    sql`SELECT id FROM products WHERE loja = 'BASE' AND codigo_interno IS NULL ORDER BY created_at ASC, id ASC`,
  );
  const baseIds = (baseSem.rows ?? []) as { id: string }[];
  for (const r of baseIds) {
    n++;
    await db.execute(sql`UPDATE products SET codigo_interno = ${String(n).padStart(5, '0')} WHERE id = ${r.id}`);
  }

  // 2) propaga o código da base para as cópias importadas nas lojas
  await db.execute(sql`
    UPDATE products s
    SET codigo_interno = b.codigo_interno
    FROM products b
    WHERE s.base_product_id = b.id
      AND s.loja <> 'BASE'
      AND b.codigo_interno IS NOT NULL
      AND s.codigo_interno IS DISTINCT FROM b.codigo_interno`);

  // 3) produtos órfãos (criados direto na loja no modelo antigo, sem base) — recebem código próprio
  const orfaos = await db.execute(
    sql`SELECT id FROM products WHERE codigo_interno IS NULL ORDER BY created_at ASC, id ASC`,
  );
  const orfaoIds = (orfaos.rows ?? []) as { id: string }[];
  for (const r of orfaoIds) {
    n++;
    await db.execute(sql`UPDATE products SET codigo_interno = ${String(n).padStart(5, '0')} WHERE id = ${r.id}`);
  }

  return { base: baseIds.length, orfaos: orfaoIds.length };
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
