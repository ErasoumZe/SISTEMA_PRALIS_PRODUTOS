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
  // importProductSchema: mesma forma, SEM a regra de estoque. Cadastro legado
  // torto vira problema de dado, nunca queda da API.
  const produtos = ProductRequests.importProductSchema.array().parse(raw);
  const repo = new ProductRepository();

  let imported = 0;
  let skipped = 0;

  for (const p of produtos) {
    const dup = await repo.findDuplicate('BASE', p.nome, p.codigoBarras ?? null);
    if (dup) {
      skipped++;
      continue;
    }
    // O código interno é atribuído JÁ na criação. Antes o seed deixava null e
    // só o backfill (passo seguinte do start:prod) preenchia — nessa janela o
    // produto podia ser espelhado na planilha com a coluna CODIGO INT. vazia,
    // e o espelho nunca mais era corrigido.
    await repo.create(p, {
      loja: 'BASE',
      codigo: genCodigo(),
      codigoInterno: await repo.proximoCodigoInterno(),
      createdByUserId: null,
      createdByName: SEED_AUTHOR,
    });
    imported++;
  }

  console.log(`✅ Seed BASE: ${imported} importados, ${skipped} já existentes (pulados). Total no arquivo: ${produtos.length}.`);
  process.exit(0);
}

/*
 * SAI COM 0 MESMO FALHANDO, de propósito.
 *
 * Este script roda no `start:prod` encadeado com `&&` ANTES do servidor. Sair
 * com erro aqui não deixa a API subir, e a empresa inteira perde o login por
 * causa de um dado ruim no arquivo de seed.
 *
 * Aconteceu em 02/09/2026: seis produtos da base com estoque máximo <= mínimo
 * pararam o seed e o container reiniciou 33 vezes. Semear a base é
 * conveniência; servir a API é o serviço. Dado ruim vira alarme no log — não
 * derruba o login de ninguém.
 */
main().catch((e) => {
  console.error('=====================================================');
  console.error('  SEED DA BASE FALHOU. A API VAI SUBIR MESMO ASSIM.');
  console.error('  Nenhum produto novo foi semeado nesta subida.');
  console.error('=====================================================');
  console.error(e);
  process.exit(0);
});
