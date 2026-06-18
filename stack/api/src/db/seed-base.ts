/**
 * Popula o catálogo BASE a partir de src/db/base-products.json (gerado por `npm run gen:base`).
 * Idempotente: pula produtos cujo NOME ou código de barras já existe na BASE.
 * Roda em runtime (sem depender da planilha nem do pacote `xlsx`) — é chamado no start:prod.
 *
 * Uso: npm run seed:base
 */
import 'reflect-metadata';
import 'dotenv/config';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { customAlphabet } from 'nanoid';
import { ProductRequests } from '@pralis/shared';
import { ProductRepository } from '@/modules/product/product.repository';

const JSON_PATH = path.resolve(process.cwd(), 'src/db/base-products.json');
const SEED_AUTHOR = 'Sistema (planilha base)';

const rand4 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', 4);
const genCodigo = () => `PR-${rand4()}-${rand4()}`;

async function main() {
  const raw = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  const produtos = ProductRequests.createProductSchema.array().parse(raw);
  const repo = new ProductRepository();

  let imported = 0;
  let skipped = 0;

  for (const p of produtos) {
    const dup = await repo.findDuplicate('BASE', p.nome, p.codigoBarras ?? null);
    if (dup) {
      skipped++;
      continue;
    }
    await repo.create(p, {
      loja: 'BASE',
      codigo: genCodigo(),
      createdByUserId: null,
      createdByName: SEED_AUTHOR,
    });
    imported++;
  }

  console.log(`✅ Seed BASE: ${imported} importados, ${skipped} já existentes (pulados). Total no arquivo: ${produtos.length}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('Falha no seed BASE:', e);
  process.exit(1);
});
