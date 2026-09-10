/**
 * Monta na planilha de produção a aba com o cadastro fiscal ECF, já confrontado
 * com o estudo tributário.
 *
 * DE ONDE VEM
 * -----------
 *  - Cadastro ANTIGO: planilha `1itKr…` (cópia sem travas), aba
 *    `MIX PRODUTOS LOJA E PRODUÇÃO ASSOCIAÇÃO`, linhas 11+. É a única fonte
 *    que tem ALIQUOTA ECF, ALIQUOTA ECF ID, CATEGORIA e CODIGO CEST — os
 *    campos que a faixa `CADASTRO - FISCAL` da planilha nova tem e ninguém
 *    preenche.
 *  - ESTUDO: `docs/fiscal-consolidado.tsv`, gerado por `estudo-fiscal.ts`.
 *
 * COMO CASA (medido, não suposto)
 * -------------------------------
 * `provar-juncao.ts` testou as três chaves candidatas contra a concordância de
 * NCM, que é o juiz: junção certa faz os dois lados falarem do mesmo produto.
 *
 *    COD INTERNO (Z) : 533 casamentos, NCM concorda em 532 = 100%
 *    REFERENCIA (P)  : 0 — a coluna é `0000000000000000` em todas as linhas
 *    NOME (M)        : 861 casamentos, NCM concorda em 859 = 100%, 8 ambíguos
 *
 * O nome usado é o do ESTUDO, nunca a coluna PRODUTO da aba fiscal: as duas
 * divergem em 57 linhas, e o código 11518 é `FANTA UVA 2L` no estudo e
 * `HAMBURGUER` na aba. Casar pelo nome errado punha NCM de refrigerante em
 * hambúrguer — foi assim que o erro apareceu.
 *
 * Nome AMBÍGUO (mais de uma linha antiga com o mesmo nome) não casa: fica como
 * está e entra no relatório. Preferir errar por omissão a atribuir imposto.
 *
 * PRECEDÊNCIA
 * -----------
 * Onde o estudo fala — NCM e CST de PIS/COFINS — vale o estudo. No resto vale
 * o cadastro antigo, que é a única fonte. A ALIQUOTA ECF é COPIADA de lá,
 * nunca derivada.
 *
 * Conferência por padrão; grava só com `--gravar`. A aba nasce OCULTA e não é
 * lida por nada — é fonte para o passo seguinte, não muda o comportamento de
 * hoje.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ANTIGA, ABA_ANTIGA, PRIMEIRA_LINHA, lerAntiga, lerEstudo,
  chaveNcm, chaveNome, texto, type LinhaAntiga,
} from './fiscal-antiga';
import { lerComprasDoEstudo } from './estudo-fiscal';

const PRODUCAO = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA_NOVA = '(TNP) FISCAL - CADASTRO ECF';

const chaveInterno = (v: unknown): string =>
  String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

const CABECALHO = [
  'COD INTERNO', 'NOME (CADASTRO ANTIGO)', 'NOME NO ESTUDO', 'CASOU POR',
  'REDUCAO_ICMS', 'ALIQUOTA CHEIA', 'ALIQUOTA FCP', 'CST PIS/COFINS',
  'ALIQUOTA PIS', 'ALIQUOTA COFINS', 'ALIQUOTA ECF', 'ALIQUOTA ECF ID',
  'NCM', 'CATEGORIA', '% NCM', 'ICMS', 'CODIGO CEST', 'ORIGEM DO NCM/CST',
];

async function main() {
  const gravar = process.argv.includes('--gravar');
  const DOCS = resolve(process.cwd(), '../../docs');
  const { GoogleSheetsClient, a1, indexToCol } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');

  // ---- fontes ----
  const meta = (await c.getSheets(ANTIGA)).find((a) => a.title === ABA_ANTIGA)!;
  const ate = indexToCol(Math.max(0, meta.columnCount - 1));
  const [corpo] = await c.batchGetValues(
    ANTIGA, [a1(ABA_ANTIGA, `A${PRIMEIRA_LINHA}:${ate}${meta.rowCount}`)], 'FORMATTED_VALUE',
  );
  const antigos = lerAntiga((corpo ?? []) as string[][]);
  const estudo = lerEstudo(DOCS);

  // ---- índices do estudo ----
  const porInterno = new Map<string, { ncm: string; cst: string; nome: string }>();
  const porNomeEstudo = new Map<string, Array<{ ncm: string; cst: string; nome: string }>>();
  for (const [codigo, e] of estudo) {
    porInterno.set(codigo, e);
    if (e.nome) porNomeEstudo.set(e.nome, [...(porNomeEstudo.get(e.nome) ?? []), e]);
  }
  // nomes que aparecem em mais de uma linha ANTIGA são ambíguos do outro lado
  const contagemAntiga = new Map<string, number>();
  for (const a of antigos) contagemAntiga.set(chaveNome(a.nome), (contagemAntiga.get(chaveNome(a.nome)) ?? 0) + 1);

  // ---- merge ----
  const linhas: string[][] = [];
  const contagem = { interno: 0, nome: 0, compras: 0, ambiguo: 0, semEstudo: 0, mudouNcm: 0, mudouCst: 0 };
  const compras = lerComprasDoEstudo();
  console.log(`  bloco de COMPRAS do estudo: ${compras.size} nomes`);

  for (const a of antigos) {
    const nomeA = chaveNome(a.nome);
    let casouPor = '';
    let e: { ncm: string; cst: string; nome: string } | undefined;

    const porCodigo = porInterno.get(chaveInterno(a.codInterno));
    if (porCodigo) { e = porCodigo; casouPor = 'COD INTERNO'; contagem.interno += 1; }
    else {
      const candidatos = porNomeEstudo.get(nomeA) ?? [];
      if (candidatos.length === 1 && (contagemAntiga.get(nomeA) ?? 0) === 1) {
        e = candidatos[0]; casouPor = 'NOME'; contagem.nome += 1;
      } else if (candidatos.length > 0) {
        casouPor = 'AMBIGUO (nao casei)'; contagem.ambiguo += 1;
      } else { casouPor = 'sem casar'; contagem.semEstudo += 1; }
    }

    /*
     * Terceira fonte: o bloco de COMPRAS do estudo, por nome. Só entra quando o
     * NCM dele JÁ CONCORDA com o do cadastro antigo — a concordância de um
     * campo independente é o que confirma que os dois falam do mesmo produto.
     * Sem essa corroboração eu estaria atribuindo CST por semelhança de nome,
     * que é exatamente o que não se faz com imposto.
     */
    if (!e) {
      const daCompra = compras.get(nomeA);
      if (daCompra && daCompra.ncm && daCompra.ncm === chaveNcm(a.ncm)) {
        e = { ncm: daCompra.ncm, cst: daCompra.cst, nome: nomeA };
        casouPor = 'COMPRAS (NCM confere)';
        contagem.compras += 1;
        contagem.semEstudo -= 1;
      }
    }

    const ncmAntigo = chaveNcm(a.ncm);
    const ncmFinal = e?.ncm || ncmAntigo;
    const cstFinal = e?.cst || a.cstPisCofins;
    if (e?.ncm && ncmAntigo && e.ncm !== ncmAntigo) contagem.mudouNcm += 1;
    if (e?.cst && a.cstPisCofins && e.cst !== a.cstPisCofins) contagem.mudouCst += 1;

    linhas.push([
      a.codInterno, a.nome, e?.nome ?? '', casouPor,
      a.reducaoIcms, a.aliquotaCheia, a.aliquotaFcp, cstFinal,
      a.aliquotaPis, a.aliquotaCofins, a.aliquotaEcf, a.aliquotaEcfId,
      ncmFinal, a.categoria, a.pctNcm, a.icms, a.cest,
      e ? 'estudo' : 'cadastro antigo',
    ]);
  }

  console.log(`\n  linhas do cadastro antigo : ${antigos.length}`);
  console.log(`  casaram por COD INTERNO   : ${contagem.interno}`);
  console.log(`  casaram por NOME          : ${contagem.nome}`);
  console.log(`  casaram por COMPRAS       : ${contagem.compras}   (só onde o NCM já conferia)`);
  console.log(`  nome ambíguo (não casei)  : ${contagem.ambiguo}`);
  console.log(`  sem correspondência       : ${contagem.semEstudo}`);
  console.log(`\n  o estudo muda o NCM em    : ${contagem.mudouNcm}`);
  console.log(`  o estudo muda o CST em    : ${contagem.mudouCst}`);
  console.log(`\n  aba de destino: "${ABA_NOVA}" na planilha de produção, OCULTA`);

  const tsv = resolve(DOCS, 'fiscal-ecf-consolidado.tsv');
  writeFileSync(tsv, [CABECALHO, ...linhas].map((l) => l.join('\t')).join('\r\n'), 'utf8');
  console.log(`  previa salva em ${tsv}`);
  console.log('\n  amostra:');
  for (const l of linhas.slice(0, 3)) console.log(`     ${l.slice(0, 4).join(' | ')} ... ECF=${l[10]} NCM=${l[12]} CST=${l[7]}`);

  if (!gravar) { console.log('\n  (rode com --gravar para criar a aba)'); process.exit(0); }

  const jaExiste = (await c.getSheets(PRODUCAO)).some((x) => x.title === ABA_NOVA);
  if (!jaExiste) {
    await c.batchUpdate(PRODUCAO, [{
      addSheet: {
        properties: {
          title: ABA_NOVA, hidden: true,
          gridProperties: { rowCount: linhas.length + 10, columnCount: CABECALHO.length },
        },
      },
    }]);
    console.log('  aba criada (oculta)');
  } else {
    console.log('  aba ja existia — regravando o conteudo');
  }

  const tudo = [CABECALHO, ...linhas];
  const BLOCO = 400;
  const ultima = indexToCol(CABECALHO.length - 1);
  for (let i = 0; i < tudo.length; i += BLOCO) {
    const pedaco = tudo.slice(i, i + BLOCO);
    await c.batchUpdateValues(
      PRODUCAO,
      [{ range: a1(ABA_NOVA, `A${i + 1}:${ultima}${i + pedaco.length}`), values: pedaco }],
      'RAW',
    );
    console.log(`  gravadas linhas ${i + 1}..${i + pedaco.length}`);
  }
  console.log('\n  pronto — aba oculta, nenhuma outra aba foi tocada');
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
