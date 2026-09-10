/**
 * Confronta o ESTUDO TRIBUTÁRIO com a tabela fiscal que o sistema usa hoje.
 *
 * O QUE O ESTUDO TEM
 * ------------------
 * `tabela/Pendrive impostos/PLANILHA DADOS TNP.xlsx`, uma aba por mês
 * ("ESTUDO FICAL TNP - JUNHO/JULHO/AGOSTO OK!"). Cada aba tem DOIS blocos, e
 * confundi-los produz lixo — o primeiro tem preço onde o segundo tem NCM:
 *
 *  - bloco de COMPRAS, cabeçalho por volta da linha 13:
 *      MERCADORIA | QUANTIDADE | TOTAL | NCM | CST PIS/COFINS
 *    chaveado por NOME, sem código;
 *
 *  - bloco de VENDAS, cabeçalho por volta da linha 700:
 *      ID DO PRODUTO | CODIGO | DESCRIÇÃO PRODUTO | VALOR UNITARIO |
 *      QUANTIDADE | TOTAL | NCM | CST PIS/COFINS | % ICMS RE
 *    chaveado por CÓDIGO — a mesma linhagem de código do
 *    `depara_fiscal_tnp.tsv` e da coluna `CÓDIGO` da aba fiscal. Conferido:
 *    o código 10243 é MOSTARDA 300G nos dois, com NCM 21033021 e CST 1.
 *
 * O bloco de VENDAS é o que vale para o cadastro: tem código, NCM, CST e ICMS.
 * O de COMPRAS entra só como segunda opinião, por nome, para produto que o
 * estudo comprou e não vendeu.
 *
 * PRECEDÊNCIA (definida pelo José)
 * --------------------------------
 * O que o estudo disser DIFERENTE, vale o estudo. O que o estudo não disser,
 * ou disser igual, mantém o que já existe na planilha. Entre meses, o mais
 * recente vence — mas toda divergência entre meses é reportada, porque mudança
 * de NCM/CST no meio do estudo é correção manual, não regra.
 *
 * Só leitura. Não grava em planilha nenhuma.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as XLSX from 'xlsx';

const PASTA = 'C:\\Users\\José\\Desktop\\Cicluz\\CADASTRO DE PRODUTOS\\tabela\\Pendrive impostos';
const ARQUIVO_ESTUDO = 'PLANILHA DADOS TNP.xlsx';
/** A planilha de produção em uso. Explícito: o `.env` local aponta para outra. */
const PRODUCAO = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';

/** Ordem cronológica: o último da lista vence o empate. */
const MESES = ['JUNHO', 'JULHO', 'AGOSTO'];

/** CST de PIS/COFINS que o estudo usa. `uso` = consumo, fora de revenda. */
const CST_VALIDOS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'uso']);

export interface DoEstudo {
  codigo: string;
  idProduto: string;
  nome: string;
  ncm: string;
  cst: string;
  icmsRe: string;
  mes: string;
}

export const texto = (v: unknown): string =>
  String(v ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();

export const chaveNome = (v: unknown): string => texto(v).toLocaleUpperCase('pt-BR');

/** NCM só com dígitos, 8 posições — o Excel come o zero à esquerda. */
export const chaveNcm = (v: unknown): string => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d === '' ? '' : d.padStart(8, '0');
};

export const chaveCst = (v: unknown): string => texto(v).toLowerCase();

/** Código sem zero à esquerda, para casar `010243` com `10243`. */
export const chaveCodigo = (v: unknown): string => {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return d;
};

/** Percentual do estudo (número puro, ex. 3.69) para o texto "3,69". */
export const percentual = (v: unknown): string => {
  const s = texto(v).replace(',', '.');
  if (s === '') return '';
  const n = Number(s);
  return Number.isFinite(n) ? String(n).replace('.', ',') : s;
};

/**
 * Valor vencedor entre os meses: MAIORIA, empate desfeito pelo mais recente.
 *
 * "O mais recente vence" sozinho é perigoso aqui. A MARGARINA QUALY C/SAL 500G
 * aparece com NCM 15171000 (margarina) em junho e julho e 16024900 em agosto —
 * e 16024900 é preparação de carne. Uma digitação errada no último mês viraria
 * classificação fiscal do cadastro.
 *
 * A maioria corrige isso sem inventar nada: escolhe entre valores que o PRÓPRIO
 * estudo afirmou, e o mês isolado perde para os dois que concordam. Onde não há
 * maioria, o mais recente decide, que é a regra original.
 */
export function vencedor(valores: ReadonlyArray<{ valor: string; mes: string }>): string {
  const votos = new Map<string, { n: number; ultimo: number }>();
  for (const { valor, mes } of valores) {
    if (valor === '') continue;
    const atual = votos.get(valor) ?? { n: 0, ultimo: -1 };
    votos.set(valor, { n: atual.n + 1, ultimo: Math.max(atual.ultimo, MESES.indexOf(mes)) });
  }
  return [...votos.entries()]
    .sort((a, b) => (b[1].n - a[1].n) || (b[1].ultimo - a[1].ultimo))[0]?.[0] ?? '';
}

/** Índice da linha de cabeçalho do bloco de VENDAS, ou -1. */
export function acharBlocoDeVendas(linhas: unknown[][]): number {
  return linhas.findIndex((l) => {
    const c = (l ?? []).map((v) => chaveNome(v));
    return c.some((x) => x.startsWith('ID DO PRODUTO')) && c.some((x) => x === 'NCM');
  });
}

/** Lê o bloco de VENDAS de uma aba de mês. */
export function lerVendas(ws: XLSX.WorkSheet, mes: string): DoEstudo[] {
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
  const cabecalho = acharBlocoDeVendas(linhas);
  if (cabecalho < 0) return [];

  const saida: DoEstudo[] = [];
  for (let i = cabecalho + 1; i < linhas.length; i += 1) {
    const l = linhas[i] ?? [];
    const codigo = chaveCodigo(l[1]);
    const ncm = chaveNcm(l[6]);
    const cst = chaveCst(l[7]);
    // Um CST fora da lista quer dizer que a leitura saiu do bloco — descarta a
    // linha em vez de inventar classificação a partir de coluna deslocada.
    if (!codigo || !ncm || !CST_VALIDOS.has(cst)) continue;
    saida.push({
      codigo,
      idProduto: texto(l[0]),
      nome: chaveNome(l[2]),
      ncm,
      cst,
      icmsRe: percentual(l[8]),
      mes,
    });
  }
  return saida;
}

async function main() {
  const arquivos = readdirSync(PASTA);
  const nomeArquivo = arquivos.find((f) => f === ARQUIVO_ESTUDO)
    ?? arquivos.find((f) => f.toUpperCase().includes('DADOS TNP'));
  if (!nomeArquivo) throw new Error(`não achei "${ARQUIVO_ESTUDO}" em ${PASTA}`);
  // `XLSX.readFile` só existe no adaptador CJS; em ESM lemos o buffer.
  const wb = XLSX.read(readFileSync(join(PASTA, nomeArquivo)), { type: 'buffer' });

  const porCodigo = new Map<string, DoEstudo[]>();
  console.log('=== ESTUDO — bloco de VENDAS ===');
  for (const mes of MESES) {
    const aba = wb.SheetNames.find((n) => chaveNome(n).includes(mes));
    if (!aba) { console.log(`  ${mes.padEnd(8)}: SEM ABA`); continue; }
    const linhas = lerVendas(wb.Sheets[aba]!, mes);
    console.log(`  ${mes.padEnd(8)}: ${linhas.length} produtos`);
    for (const linha of linhas) {
      porCodigo.set(linha.codigo, [...(porCodigo.get(linha.codigo) ?? []), linha]);
    }
  }
  console.log(`  códigos distintos: ${porCodigo.size}`);

  // ---- o estudo é estável entre os meses? ----
  const instaveis: string[] = [];
  const final = new Map<string, DoEstudo>();
  for (const [codigo, ocorrencias] of porCodigo) {
    const ncms = new Set(ocorrencias.map((o) => o.ncm));
    const csts = new Set(ocorrencias.map((o) => o.cst));
    const maisRecente = [...ocorrencias]
      .sort((a, b) => MESES.indexOf(a.mes) - MESES.indexOf(b.mes)).pop()!;
    /*
     * NCM e CST pela MAIORIA; % ICMS RE pelo MAIS RECENTE.
     *
     * A distinção importa. Um NCM ou um CST é CLASSIFICAÇÃO: o produto é o que
     * é, não muda de um mês para o outro. Um mês sozinho que discorda dos
     * outros dois é digitação errada — foi o caso da MARGARINA virando
     * preparação de carne em agosto.
     *
     * Já o % ICMS RE é ALÍQUOTA, e alíquota muda de verdade. Aplicar maioria
     * nele descartaria uma atualização legítima do último mês só por ser nova:
     * o PAPEL DE CEDA e o PÃO DE SAL FUNCIONÁRIO passaram a 3,69 em agosto
     * depois de dois meses em zero, e isso tem cara de correção, não de erro.
     */
    const resolvido: DoEstudo = {
      ...maisRecente,
      ncm: vencedor(ocorrencias.map((o) => ({ valor: o.ncm, mes: o.mes }))),
      cst: vencedor(ocorrencias.map((o) => ({ valor: o.cst, mes: o.mes }))),
      icmsRe: maisRecente.icmsRe,
    };
    // Toda instabilidade é reportada, inclusive a de ICMS, que a regra não
    // resolve por maioria: nenhuma mudança de valor fiscal pode passar calada.
    const icmss = new Set(ocorrencias.map((o) => o.icmsRe).filter((v) => v !== ''));
    if (ncms.size > 1 || csts.size > 1 || icmss.size > 1) {
      const descartaORecente = resolvido.ncm !== maisRecente.ncm || resolvido.cst !== maisRecente.cst;
      instaveis.push(
        `  ${codigo} ${ocorrencias[0]!.nome}\n     ${ocorrencias
          .map((o) => `${o.mes}: NCM ${o.ncm} CST ${o.cst} ICMS ${o.icmsRe || '-'}`).join('\n     ')}`
        + `\n     -> vale: NCM ${resolvido.ncm} CST ${resolvido.cst} ICMS ${resolvido.icmsRe || '-'}`
        + (descartaORecente ? '   (a maioria DESCARTA o mês mais recente)' : ''),
      );
    }
    final.set(codigo, resolvido);
  }
  console.log(`  mudaram de NCM/CST/ICMS entre meses: ${instaveis.length}`);
  // todos, sem cortar: cada um destes é um valor fiscal que a maioria decidiu
  if (instaveis.length) console.log(instaveis.join('\n'));

  // ---- a tabela fiscal de hoje ----
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const { env } = await import('@/config/env');
  const c = new GoogleSheetsClient();
  const [linhasFiscal] = await c.batchGetValues(
    PRODUCAO, [a1(env.GOOGLE_SHEETS_FISCAL_TAB, 'A4:E2000')], 'FORMATTED_VALUE',
  );

  interface NaPlanilha { linha: number; codigo: string; ncm: string; cst: string; icms: string; nome: string }
  const daPlanilha: NaPlanilha[] = ((linhasFiscal ?? []) as string[][])
    .map((r, i) => ({
      linha: 4 + i,
      codigo: chaveCodigo(r?.[0]),
      ncm: chaveNcm(r?.[1]),
      cst: chaveCst(r?.[2]),
      icms: texto(r?.[3]),
      nome: chaveNome(r?.[4]),
    }))
    .filter((p) => p.codigo !== '');

  const anonimos = daPlanilha.filter((p) => p.nome.startsWith('(NAO VENDIDO')).length;
  console.log(`\n=== PLANILHA (aba fiscal "${env.GOOGLE_SHEETS_FISCAL_TAB}", A4:E2000) ===`);
  console.log(`  produtos: ${daPlanilha.length}`);
  console.log(`  marcados "(nao vendido no periodo)": ${anonimos}`);

  // ---- confronto por CÓDIGO ----
  const porCodigoNaPlanilha = new Map(daPlanilha.map((p) => [p.codigo, p]));
  let concordam = 0;
  const mudaNcm: string[] = [];
  const mudaCst: string[] = [];
  const mudaIcms: string[] = [];
  const ganhaNome: string[] = [];
  const soNoEstudo: DoEstudo[] = [];

  for (const [codigo, e] of final) {
    const p = porCodigoNaPlanilha.get(codigo);
    if (!p) { soNoEstudo.push(e); continue; }
    let mudou = false;
    if (e.ncm !== p.ncm) {
      mudou = true;
      mudaNcm.push(`  ${codigo} ${e.nome}\n     planilha ${p.ncm}  ->  estudo ${e.ncm}   (${e.mes}, L${p.linha})`);
    }
    if (e.cst !== p.cst) {
      mudou = true;
      mudaCst.push(`  ${codigo} ${e.nome}\n     planilha CST ${p.cst}  ->  estudo CST ${e.cst}   (${e.mes}, L${p.linha})`);
    }
    if (e.icmsRe && e.icmsRe !== p.icms) {
      mudou = true;
      mudaIcms.push(`  ${codigo} ${e.nome}: planilha ${p.icms || '-'} -> estudo ${e.icmsRe}`);
    }
    if (p.nome.startsWith('(NAO VENDIDO') && e.nome) ganhaNome.push(`  ${codigo}: ${e.nome}`);
    if (!mudou) concordam += 1;
  }
  const soNaPlanilha = daPlanilha.filter((p) => !final.has(p.codigo));

  /*
   * O bloco de COMPRAS entra como segunda opinião: produto que a loja comprou
   * e não vendeu no período não tem código no estudo, só nome. Não dá para
   * casar por código — serve para saber o TAMANHO do que ainda falta.
   */
  const nomesVendidos = new Set([...final.values()].map((e) => e.nome));
  const compras = new Map<string, { ncm: string; cst: string }>();
  for (const mes of MESES) {
    const aba = wb.SheetNames.find((n) => chaveNome(n).includes(mes));
    if (!aba) continue;
    const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba]!, { header: 1, raw: true, defval: '' });
    const ini = linhas.findIndex((l) => chaveNome((l ?? [])[0]).startsWith('MERCADORIA'));
    const fim = acharBlocoDeVendas(linhas);
    if (ini < 0) continue;
    for (let i = ini + 1; i < (fim > 0 ? fim : linhas.length); i += 1) {
      const l = linhas[i] ?? [];
      const nome = chaveNome(l[0]);
      const ncm = chaveNcm(l[3]);
      const cst = chaveCst(l[4]);
      // NCM curto = a leitura saiu do bloco e pegou preço
      if (!nome || String(l[3] ?? '').replace(/\D/g, '').length < 7 || !CST_VALIDOS.has(cst)) continue;
      compras.set(nome, { ncm, cst });
    }
  }
  const soCompras = [...compras.keys()].filter((n) => !nomesVendidos.has(n));

  console.log(`\n=== CONFRONTO por CÓDIGO ===`);
  console.log(`  casaram e concordam em tudo : ${concordam}`);
  console.log(`  o estudo muda o NCM         : ${mudaNcm.length}`);
  console.log(`  o estudo muda o CST         : ${mudaCst.length}`);
  console.log(`  o estudo muda o % ICMS RE   : ${mudaIcms.length}`);
  console.log(`  ganham nome (estavam anônimos na planilha): ${ganhaNome.length}`);
  console.log(`  só no estudo (entrariam novos): ${soNoEstudo.length}`);
  console.log(`  só na planilha (estudo calou) : ${soNaPlanilha.length}  <- mantém como está`);
  soNaPlanilha.forEach((p) => console.log(`     L${p.linha}: ${p.codigo} NCM ${p.ncm} CST ${p.cst} ${p.nome}`));
  console.log(`\n  bloco de COMPRAS: ${compras.size} nomes; ${soCompras.length} deles não aparecem nas vendas`);
  soCompras.slice(0, 10).forEach((n) => console.log(`     ${n} -> NCM ${compras.get(n)!.ncm} CST ${compras.get(n)!.cst}`));

  if (mudaNcm.length) { console.log(`\n--- NCM que o estudo corrige (primeiros 10) ---`); console.log(mudaNcm.slice(0, 10).join('\n')); }
  if (mudaCst.length) { console.log(`\n--- CST que o estudo corrige (primeiros 10) ---`); console.log(mudaCst.slice(0, 10).join('\n')); }
  if (mudaIcms.length) { console.log(`\n--- %ICMS RE que o estudo corrige (primeiros 10) ---`); console.log(mudaIcms.slice(0, 10).join('\n')); }

  // ---- o resultado da regra, pronto para virar aba ----
  const cabecalho = ['CÓDIGO', 'NCM', 'CST PIS/COFINS', '% ICMS RE', 'PRODUTO', 'ORIGEM'];
  const linhas: string[][] = [];
  for (const p of daPlanilha) {
    const e = final.get(p.codigo);
    if (!e) { linhas.push([p.codigo, p.ncm, p.cst, p.icms, p.nome, 'planilha (estudo calou)']); continue; }
    const mudou = e.ncm !== p.ncm || e.cst !== p.cst || (!!e.icmsRe && e.icmsRe !== p.icms);
    linhas.push([
      p.codigo, e.ncm, e.cst, e.icmsRe || p.icms,
      p.nome.startsWith('(NAO VENDIDO') ? e.nome : p.nome,
      mudou ? `estudo ${e.mes} (corrige)` : 'iguais',
    ]);
  }
  for (const e of soNoEstudo) {
    linhas.push([e.codigo, e.ncm, e.cst, e.icmsRe, e.nome, `estudo ${e.mes} (novo)`]);
  }

  const destino = resolve(process.cwd(), '../../docs/fiscal-consolidado.tsv');
  writeFileSync(destino, [cabecalho, ...linhas].map((l) => l.join('\t')).join('\r\n'), 'utf8');
  console.log(`\n  resultado da regra: ${linhas.length} linhas em ${destino}`);
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
