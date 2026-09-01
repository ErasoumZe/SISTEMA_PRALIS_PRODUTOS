/**
 * Popula `sia_produto_depara` a partir de uma exportação do SIA Supervisor.
 *
 *   npm run creare:depara -- <arquivo.xls|.csv> --loja LI
 *
 * O arquivo NÃO é versionado: é o catálogo real da loja. O script é a única
 * porta de entrada dessa tabela, e ele recusa antes de gravar quando o
 * casamento por código de barras ficaria ambíguo — um de-para ambíguo é pior
 * que de-para nenhum, porque manda o produto errado para o PDV.
 *
 * A leitura e a validação vivem em `sia-depara.parser.ts`, que não importa
 * banco e por isso pode ser testado.
 */
import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { siaProdutoDePara } from './creare.table';
import { lerArquivo, lerDePara } from './sia-depara.parser';

const LOJAS = ['TNP', 'LI', 'HORA'] as const;
type Loja = (typeof LOJAS)[number];

async function main(): Promise<void> {
  const argumentos = process.argv.slice(2);
  const caminho = argumentos.find((a) => !a.startsWith('--'));
  const loja = argumentos[argumentos.indexOf('--loja') + 1] as Loja | undefined;

  if (!caminho || !loja || !LOJAS.includes(loja)) {
    console.error('uso: npm run creare:depara -- <arquivo.xls|.csv> --loja <TNP|LI|HORA>');
    process.exit(2);
  }

  const resultado = lerDePara(lerArquivo(caminho));
  console.log(`lidas ${resultado.linhas.length} linhas com codigo de barras`);
  if (resultado.semBarras) console.log(`  ${resultado.semBarras} sem codigo de barras - ficam de fora`);

  if (resultado.barrasAmbiguas.length) {
    console.error(`\nRECUSADO: ${resultado.barrasAmbiguas.length} codigo(s) de barras apontam para mais de um produto no SIA.`);
    for (const a of resultado.barrasAmbiguas.slice(0, 10)) {
      console.error(`  barras ${a.chave} -> coditens ${a.coditens.join(', ')}`);
    }
    console.error('Resolva no SIA antes de importar: casar por barras aqui mandaria o produto errado para o PDV.');
    process.exit(1);
  }
  if (resultado.coditensRepetidos.length) {
    console.error(`\nRECUSADO: coditem repetido na exportacao (${resultado.coditensRepetidos.slice(0, 10).join(', ')}).`);
    process.exit(1);
  }

  // snapshot completo: a exportação é a verdade do momento
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM sia_produto_depara WHERE loja = ${loja}`);
    const lote = 500;
    for (let i = 0; i < resultado.linhas.length; i += lote) {
      await tx.insert(siaProdutoDePara).values(
        resultado.linhas.slice(i, i + lote).map((l) => ({ ...l, loja })),
      );
    }
  });

  console.log(`\ngravadas ${resultado.linhas.length} linhas para ${loja}.`);
  process.exit(0);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
