/**
 * Backfill da carga fiscal — linha de comando.
 *
 * Conferência por padrão. Só escreve com `--apply`, e ainda assim em lotes
 * pequenos, retomáveis pelo cursor que ele imprime ao fim de cada rodada.
 *
 * Uso:
 *   tsx scripts/backfill-fiscal.ts                          # panorama + dry-run
 *   tsx scripts/backfill-fiscal.ts --limite 50
 *   tsx scripts/backfill-fiscal.ts --loja BASE
 *   tsx scripts/backfill-fiscal.ts --produto <uuid>         # canário
 *   tsx scripts/backfill-fiscal.ts --cursor <uuid>          # retomada
 *   tsx scripts/backfill-fiscal.ts --apply --limite 50      # grava
 *
 * O `--apply` não roda em produção sem autorização explícita: a decisão de
 * reescrever fiscal em massa é do dono do cadastro, não de quem programa.
 */
import 'reflect-metadata';
import 'dotenv/config';

const arg = (nome: string): string | undefined => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const aplicar = process.argv.includes('--apply');
  const { container } = await import('tsyringe');
  const { BackfillFiscalService } = await import('@/modules/apoio/backfill-fiscal.service');
  const servico = container.resolve(BackfillFiscalService);

  console.log(aplicar ? '=== APLICANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');

  const panorama = await servico.panorama();
  console.log('\npanorama do catalogo hoje:');
  for (const [estado, n] of Object.entries(panorama).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${estado}`);
  }

  const r = await servico.executar({
    productId: arg('produto'),
    loja: arg('loja'),
    limite: arg('limite') ? Number(arg('limite')) : undefined,
    cursor: arg('cursor'),
  }, aplicar);

  console.log(`\nanalisados nesta rodada: ${r.analisados}`);
  console.log('resultado por estado:');
  for (const [estado, n] of Object.entries(r.porEstado).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${estado}`);
  }

  console.log(`\n${aplicar ? 'alterados' : 'seriam alterados'}: ${r.alterados.length}`);
  for (const a of r.alterados.slice(0, 15)) {
    console.log(`  ${a.nome.slice(0, 38).padEnd(40)} ${a.de} -> ${a.para}`);
    if (a.para !== 'completo') console.log(`      ${a.motivo}`);
  }
  if (r.alterados.length > 15) console.log(`  ... e mais ${r.alterados.length - 15}`);

  if (r.proximoCursor) {
    console.log(`\npara continuar: --cursor ${r.proximoCursor}`);
  }
  if (!aplicar && r.alterados.length) {
    console.log('\n(rode com --apply para gravar)');
  }
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
