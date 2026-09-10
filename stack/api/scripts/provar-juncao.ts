/**
 * Prova qual coluna casa o cadastro antigo com o estudo — e prova pelo DADO,
 * não pelo nome da coluna.
 *
 * O critério é a concordância de NCM. Se a junção estiver certa, os dois lados
 * falam do mesmo produto e o NCM bate na esmagadora maioria. Se estiver errada,
 * o NCM diverge muito — foi o que denunciou a junção por nome, que punha NCM de
 * refrigerante em hambúrguer.
 *
 * Só leitura.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { resolve } from 'node:path';
import {
  ANTIGA, ABA_ANTIGA, PRIMEIRA_LINHA, lerAntiga, lerEstudo,
  chaveBarras, chaveNcm, chaveNome, type LinhaAntiga,
} from './fiscal-antiga';

/** Código interno sem zeros à esquerda: `010010` -> `10010`. */
const chaveInterno = (v: unknown): string =>
  String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

async function main() {
  const DOCS = resolve(process.cwd(), '../../docs');
  const { GoogleSheetsClient, a1, indexToCol } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();
  const meta = (await c.getSheets(ANTIGA)).find((a) => a.title === ABA_ANTIGA)!;
  const ate = indexToCol(Math.max(0, meta.columnCount - 1));
  const [corpo] = await c.batchGetValues(
    ANTIGA, [a1(ABA_ANTIGA, `A${PRIMEIRA_LINHA}:${ate}${meta.rowCount}`)], 'FORMATTED_VALUE',
  );
  const antigos = lerAntiga((corpo ?? []) as string[][]);
  const estudo = lerEstudo(DOCS);

  const barrasReais = antigos.filter((a) => chaveBarras(a.barras) !== '' && chaveBarras(a.barras) !== '0').length;
  console.log(`antigos: ${antigos.length} linhas; com REFERENCIA que não seja só zero: ${barrasReais}`);
  console.log(`estudo : ${estudo.size} códigos\n`);

  const candidatas: Array<[string, (a: LinhaAntiga) => string]> = [
    ['COD INTERNO (Z)', (a) => chaveInterno(a.codInterno)],
    ['REFERENCIA (P)', (a) => chaveBarras(a.barras)],
    ['NOME (M)', (a) => chaveNome(a.nome)],
  ];

  for (const [rotulo, extrair] of candidatas) {
    const indice = new Map<string, LinhaAntiga[]>();
    for (const a of antigos) {
      const k = extrair(a);
      if (!k || k === '0') continue;
      indice.set(k, [...(indice.get(k) ?? []), a]);
    }

    let casou = 0;
    let ambiguo = 0;
    let ncmIgual = 0;
    let ncmDiferente = 0;
    const exemplosRuins: string[] = [];

    for (const [codigo, e] of estudo) {
      // por NOME a chave do estudo é o nome; nas outras, o código
      const chave = rotulo.startsWith('NOME') ? e.nome : codigo;
      const achados = indice.get(chave) ?? [];
      if (achados.length === 0) continue;
      if (achados.length > 1) { ambiguo += 1; continue; }
      casou += 1;
      const a = achados[0]!;
      const ncmAntigo = chaveNcm(a.ncm);
      if (!ncmAntigo || !e.ncm) continue;
      if (ncmAntigo === e.ncm) ncmIgual += 1;
      else {
        ncmDiferente += 1;
        if (exemplosRuins.length < 3) exemplosRuins.push(`      ${codigo} ${e.nome} | antiga ${ncmAntigo} vs estudo ${e.ncm} | L${a.linha} "${a.nome}"`);
      }
    }

    const comparados = ncmIgual + ncmDiferente;
    const acerto = comparados ? Math.round((ncmIgual / comparados) * 100) : 0;
    console.log(`--- junção por ${rotulo}`);
    console.log(`    casou em ${casou} dos ${estudo.size} códigos do estudo (${ambiguo} ambíguos)`);
    console.log(`    NCM concorda em ${ncmIgual} de ${comparados}  =  ${acerto}%`);
    if (exemplosRuins.length) console.log(`    exemplos de discordância:\n${exemplosRuins.join('\n')}`);
    console.log('');
  }
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
