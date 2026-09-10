/**
 * Extrai o cadastro fiscal ANTIGO e mede o casamento dele com o estudo.
 *
 * ORIGEM
 * ------
 * Planilha `1itKr…` (cópia sem travas), aba `MIX PRODUTOS LOJA E PRODUÇÃO
 * ASSOCIAÇÃO`. Cabeçalho na linha 6, dados a partir da 11 — as linhas 7 a 10
 * são cabeçalho repetido entre aspas, contagem de colunas e larguras.
 *
 * As colunas fiscais têm exatamente os nomes da faixa `CADASTRO - FISCAL` da
 * planilha nova, e é isso que faz esta aba ser a fonte que falta:
 *   AC REDUCAO_ICMS · AD ALIQUOTA CHEIA · AE ALIQUOTA FCP · AF CST PIS/COFINS
 *   AG ALIQUOTA PIS · AH ALIQUOTA COFINS · AI ALIQUOTA ECF · AJ ALIQUOTA ECF ID
 *   AK NCM · AL CATEGORIA · AM % NCM · AN ICMS · AQ CODIGO CEST
 *
 * Identidade: M DESCRIÇÃO · P REFERENCIA (barras, com zeros à esquerda) ·
 * Z COD INTERNO.
 *
 * PRECEDÊNCIA
 * -----------
 * O estudo manda no que ele diz (NCM e CST de PIS/COFINS). No resto — e é a
 * maior parte, incluindo TODA a parte de ECF — vale o cadastro antigo, porque
 * o estudo simplesmente não fala disso.
 *
 * Atenção ao CST: o cadastro antigo traz `99` ("outras operações"), que é
 * marcação genérica de ECF; o estudo traz a classificação de verdade (1, 4, 5,
 * 6). Onde os dois falam, o estudo vence — que é a regra do José.
 *
 * A alíquota de ECF é COPIADA daqui, nunca derivada. É a regra de sempre.
 *
 * Só leitura. Não grava em planilha nenhuma.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ANTIGA = '1itKr_GIBE7u0xCpsfM3YtzhaIFqhpVnC4pGFSj0B2nA';
export const ABA_ANTIGA = 'MIX PRODUTOS LOJA E PRODUÇÃO ASSOCIAÇÃO';
export const PRIMEIRA_LINHA = 11;

/** Coluna de cada campo, por LETRA — conferido no cabeçalho da linha 6. */
export const COLUNAS = {
  nome: 'M', barras: 'P', codInterno: 'Z',
  reducaoIcms: 'AC', aliquotaCheia: 'AD', aliquotaFcp: 'AE', cstPisCofins: 'AF',
  aliquotaPis: 'AG', aliquotaCofins: 'AH', aliquotaEcf: 'AI', aliquotaEcfId: 'AJ',
  ncm: 'AK', categoria: 'AL', pctNcm: 'AM', icms: 'AN', cest: 'AQ',
} as const;

export type Campo = keyof typeof COLUNAS;

export const texto = (v: unknown): string =>
  String(v ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();

export const chaveNome = (v: unknown): string => texto(v).toLocaleUpperCase('pt-BR');

/** Barras/código sem zero à esquerda — é como o estudo guarda. */
export const chaveBarras = (v: unknown): string =>
  String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

export const chaveNcm = (v: unknown): string => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d === '' ? '' : d.padStart(8, '0');
};

const indice = (letra: string): number =>
  letra.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

export type LinhaAntiga = Record<Campo, string> & { linha: number };

export function lerAntiga(linhas: string[][]): LinhaAntiga[] {
  const saida: LinhaAntiga[] = [];
  linhas.forEach((l, i) => {
    const pega = (c: Campo) => texto((l ?? [])[indice(COLUNAS[c])]);
    const nome = pega('nome');
    // sem nome não é produto: são as linhas de rodapé e de largura
    if (!nome) return;
    saida.push({
      linha: PRIMEIRA_LINHA + i,
      nome, barras: pega('barras'), codInterno: pega('codInterno'),
      reducaoIcms: pega('reducaoIcms'), aliquotaCheia: pega('aliquotaCheia'),
      aliquotaFcp: pega('aliquotaFcp'), cstPisCofins: pega('cstPisCofins'),
      aliquotaPis: pega('aliquotaPis'), aliquotaCofins: pega('aliquotaCofins'),
      aliquotaEcf: pega('aliquotaEcf'), aliquotaEcfId: pega('aliquotaEcfId'),
      ncm: pega('ncm'), categoria: pega('categoria'), pctNcm: pega('pctNcm'),
      icms: pega('icms'), cest: pega('cest'),
    });
  });
  return saida;
}

interface DoEstudo { ncm: string; cst: string; icms: string; nome: string }

/** O estudo já resolvido, de `estudo-fiscal.ts`. */
export function lerEstudo(docs: string): Map<string, DoEstudo> {
  const tsv = readFileSync(resolve(docs, 'fiscal-consolidado.tsv'), 'utf8').replace(/^﻿/, '');
  const linhas = tsv.split(/\r?\n/).filter((l) => l.trim() !== '');
  linhas.shift();
  const mapa = new Map<string, DoEstudo>();
  for (const l of linhas) {
    const [codigo = '', ncm = '', cst = '', icms = '', produto = '', , nomeEstudo = ''] = l.split('\t');
    const chave = chaveBarras(codigo);
    /*
     * O nome que vale para casar é o do ESTUDO, não o da coluna PRODUTO da aba
     * fiscal: os dois divergem em 57 linhas, e o código 11518 é `FANTA UVA 2L`
     * no estudo e `HAMBURGUER` na aba. Casar pelo nome errado foi o que pôs NCM
     * de refrigerante em hambúrguer na primeira medição.
     */
    if (chave) {
      mapa.set(chave, {
        ncm: chaveNcm(ncm), cst: texto(cst), icms: texto(icms),
        nome: chaveNome(nomeEstudo || produto),
      });
    }
  }
  return mapa;
}

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

  console.log('=== CADASTRO FISCAL ANTIGO ===');
  console.log(`  linhas com produto: ${antigos.length}`);
  const comBarras = antigos.filter((a) => chaveBarras(a.barras) !== '').length;
  const comNcm = antigos.filter((a) => chaveNcm(a.ncm) !== '').length;
  const comEcf = antigos.filter((a) => a.aliquotaEcf !== '').length;
  const comCest = antigos.filter((a) => a.cest !== '').length;
  console.log(`  com código de barras: ${comBarras}`);
  console.log(`  com NCM             : ${comNcm}`);
  console.log(`  com ALIQUOTA ECF    : ${comEcf}   <- o que a planilha nova nao tem`);
  console.log(`  com CODIGO CEST     : ${comCest}`);
  const csts = new Map<string, number>();
  for (const a of antigos) csts.set(a.cstPisCofins || '(vazio)', (csts.get(a.cstPisCofins || '(vazio)') ?? 0) + 1);
  console.log(`  CST PIS/COFINS presentes: ${[...csts.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k}=${n}`).join('  ')}`);

  // ---- casamento com o estudo ----
  const estudo = lerEstudo(DOCS);
  console.log(`\n=== ESTUDO (ja resolvido) : ${estudo.size} codigos ===`);

  const porBarras = new Map<string, LinhaAntiga>();
  for (const a of antigos) {
    const k = chaveBarras(a.barras);
    if (k && !porBarras.has(k)) porBarras.set(k, a);
  }
  const porNome = new Map<string, LinhaAntiga[]>();
  for (const a of antigos) porNome.set(a.nome, [...(porNome.get(a.nome) ?? []), a]);

  let casaBarras = 0;
  let casaNomeUnico = 0;
  let casaNomeAmbiguo = 0;
  let semCasar = 0;
  const divergeNcm: string[] = [];
  const divergeCst: string[] = [];

  for (const [codigo, e] of estudo) {
    let alvo = porBarras.get(codigo);
    if (alvo) casaBarras += 1;
    else {
      const candidatos = porNome.get(e.nome) ?? [];
      if (candidatos.length === 1) { alvo = candidatos[0]; casaNomeUnico += 1; }
      else if (candidatos.length > 1) { casaNomeAmbiguo += 1; }
      else { semCasar += 1; }
    }
    if (!alvo) continue;
    if (e.ncm && chaveNcm(alvo.ncm) && e.ncm !== chaveNcm(alvo.ncm)) {
      divergeNcm.push(`  ${codigo} ${e.nome}: antiga ${chaveNcm(alvo.ncm)} -> estudo ${e.ncm}  (L${alvo.linha})`);
    }
    if (e.cst && alvo.cstPisCofins && e.cst !== alvo.cstPisCofins) {
      divergeCst.push(`  ${codigo} ${e.nome}: antiga CST ${alvo.cstPisCofins} -> estudo CST ${e.cst}  (L${alvo.linha})`);
    }
  }

  console.log(`  casaram por CODIGO DE BARRAS : ${casaBarras}`);
  console.log(`  casaram por NOME (1 candidato): ${casaNomeUnico}`);
  console.log(`  nome com MAIS DE UM candidato : ${casaNomeAmbiguo}   <- nao caso: ambiguo`);
  console.log(`  sem casar                     : ${semCasar}`);
  console.log(`\n  o estudo muda o NCM em ${divergeNcm.length} produtos`);
  console.log(divergeNcm.slice(0, 10).join('\n'));
  console.log(`\n  o estudo muda o CST em ${divergeCst.length} produtos`);
  console.log(divergeCst.slice(0, 6).join('\n'));

  // ---- amostra do que a planilha nova ganharia ----
  const destino = resolve(DOCS, 'fiscal-antigo.tsv');
  const campos = Object.keys(COLUNAS) as Campo[];
  const linhas = [campos.join('\t'), ...antigos.map((a) => campos.map((k) => a[k]).join('\t'))];
  writeFileSync(destino, linhas.join('\r\n'), 'utf8');
  console.log(`\n  cadastro antigo salvo em ${destino} (${antigos.length} linhas)`);
  process.exit(0);
}

// Este arquivo também é biblioteca: `provar-juncao.ts` importa as funções de
// leitura. Sem esta guarda, o simples import rodaria `main()` e encerraria o
// processo do outro script antes dele começar.
if (process.argv[1]?.includes('fiscal-antiga')) {
  main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
}
