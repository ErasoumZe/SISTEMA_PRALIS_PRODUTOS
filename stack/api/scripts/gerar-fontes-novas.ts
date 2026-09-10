/**
 * Gera os dois arquivos de fonte novos da Central:
 *
 *  - `fonte_planilha_nova.csv`  — os produtos da planilha nova (o cadastro que
 *    passa a valer);
 *  - `fonte_vendidos_tnp.csv`   — os produtos que a TNP já vendeu, depois do
 *    filtro de preço-sentinela e da fusão do delivery.
 *
 * Só leitura da planilha; escreve apenas em `docs/`.
 *
 * Uso: tsx scripts/gerar-fontes-novas.ts [caminho do CSV de vendidos]
 */
import 'reflect-metadata';
import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';
const DOCS = resolve(process.cwd(), '../../docs');

/** Aspas do Excel: o zero à esquerda some sem isso. */
const protegido = (v: string) => `="${String(v ?? '').replace(/"/g, '')}"`;
const campo = (v: string) => {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function planilhaNova(): Promise<number> {
  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();

  // D nome · F codigo de barras · C status · M grupo de revenda · O grupo de transformacao
  const cols = ['D', 'F', 'C', 'M', 'O'];
  const lido = await c.batchGetValues(NOVA, cols.map((x) => a1(ABA, `${x}11:${x}`)), 'FORMATTED_VALUE');
  const col = (i: number) => (lido[i] ?? []).map((r) => String((r as string[])?.[0] ?? '').trim());
  const [nomes, barras, status, grupoR, grupoT] = [col(0), col(1), col(2), col(3), col(4)];

  const linhas = ['COD_INTERNO;COD_BARRAS;NOME;GRUPO;ATIVO'];
  let n = 0;
  for (let i = 0; i < nomes.length; i += 1) {
    const nome = nomes[i] ?? '';
    if (!nome) continue;
    n += 1;
    /*
     * O GRUPO da planilha nova NAO entra.
     *
     * A coluna de transformacao traz "MER MAT. PRIMA - FARINHAS" para abacaxi,
     * acem bovino e acucar — tem cara de valor padrao que ninguem trocou, nao
     * de classificacao. E o grupo define a REGRA FISCAL: propagar isso poria
     * aliquota de farinha em carne.
     *
     * O grupo confiavel continua vindo do SIA, que e por produto. Quando o
     * Jose revisar a classificacao da planilha, basta trocar esta linha.
     */
    const grupo = '';
    const ativo = (status[i] ?? '').toUpperCase().startsWith('INATIV') ? 'Não' : 'Sim';
    linhas.push([protegido(''), protegido(barras[i] ?? ''), campo(nome), campo(grupo), ativo].join(';'));
  }
  writeFileSync(resolve(DOCS, 'fonte_planilha_nova.csv'), `﻿${linhas.join('\r\n')}`, 'utf8');
  return n;
}

function vendidos(origem: string): number {
  if (!existsSync(origem)) {
    console.log(`  !! ${origem} não existe — pulando os vendidos`);
    return 0;
  }
  const bruto = readFileSync(origem, 'utf8').replace(/^﻿/, '');
  const linhasCsv = bruto.split(/\r?\n/).filter(Boolean);
  const cab = linhasCsv.shift()!.split(';').map((x) => x.replace(/^"|"$/g, '').trim());
  const iCod = cab.findIndex((x) => /^COD/i.test(x));
  const iNome = cab.findIndex((x) => /PRODUTO/i.test(x));

  const saida = ['COD_INTERNO;COD_BARRAS;NOME;GRUPO;ATIVO'];
  let n = 0;
  for (const l of linhasCsv) {
    const cols = l.split(';');
    const cod = String(cols[iCod] ?? '').replace(/^="?|"$/g, '').trim();
    const nome = String(cols[iNome] ?? '').replace(/^"|"$/g, '').trim();
    if (!nome) continue;
    n += 1;
    /*
     * O código que o PDV manda é de BARRAS, não interno — medido: 1.829 dos
     * 1.959 casam por barras e ZERO por código interno.
     */
    saida.push([protegido(''), protegido(cod), campo(nome), '', 'Sim'].join(';'));
  }
  writeFileSync(resolve(DOCS, 'fonte_vendidos_tnp.csv'), `﻿${saida.join('\r\n')}`, 'utf8');
  return n;
}

async function main() {
  const origemVendidos = process.argv[2]
    ?? resolve(process.cwd(), '../../../produtos-vendidos-LIMPO.csv');

  const a = await planilhaNova();
  console.log(`  fonte_planilha_nova.csv : ${a} produtos`);
  const b = vendidos(origemVendidos);
  console.log(`  fonte_vendidos_tnp.csv  : ${b} produtos`);
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
