import 'reflect-metadata';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { GoogleSheetsClient, a1, indexToCol } from '@/modules/google-sheets/google-sheets.client';

const COMPILART = String.raw`C:\Users\José\Downloads\produtos_pralis_convertidos-compilart.xlsx`;
const EXPORTACAO = String.raw`C:\Users\José\Downloads\produtos-20260918.csv`;
const SAIDA = path.resolve(process.cwd(), '../../../tmp/codigo-interno-auditoria/auditoria-preliminar.json');
const PLANILHAS = [
  { id: '1yjwgMIhP77qOgpNgaHUtIXZ6V_H66PKgDBnBBhXqT0U', nome: 'planilha_compilart' },
  { id: '1xoPA6FqhLgix0cQSiyEgX56sO_X8QErz-9aZtrkGZAY', nome: 'planilha_oficial' },
];

const texto = (v: unknown) => String(v ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
const digitos = (v: unknown) => texto(v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const nomeNormal = (v: unknown) => texto(v).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = (rows.shift() ?? []).map((h) => h.replace(/^\uFEFF/, ''));
  return rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').replace(/^=/, '')])));
}

async function main() {
  const wb = XLSX.readFile(COMPILART, { raw: false });
  const itens = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Produtos, { defval: '' }).map((r) => ({
    codigoInterno: digitos(r['Cód. Interno']),
    ean: digitos(r['Código Produto Padrão']),
    nome: texto(r['Descrição']),
    nomeNormal: nomeNormal(r['Descrição']),
    ativo: texto(r.Ativo),
    pagina: texto(r['Página PDF']),
  }));
  const produtos = parseCsv(fs.readFileSync(EXPORTACAO, 'utf8')).map((r) => ({
    id: r.id, loja: r.loja, codigo: r.codigo, ean: digitos(r.codigo_barras),
    codigoInterno: digitos(r.codigo_interno), baseProductId: r.base_product_id,
    nome: r.nome, nomeNormal: nomeNormal(r.nome), status: r.status,
  }));
  const byEan = new Map<string, typeof itens>();
  for (const item of itens) if (item.ean) byEan.set(item.ean, [...(byEan.get(item.ean) ?? []), item]);
  const byName = new Map<string, typeof itens>();
  for (const item of itens) if (item.nomeNormal) byName.set(item.nomeNormal, [...(byName.get(item.nomeNormal) ?? []), item]);

  const linhas = produtos.map((p) => {
    const eanMatches = p.ean ? byEan.get(p.ean) ?? [] : [];
    const nomeMatches = byName.get(p.nomeNormal) ?? [];
    const codigosEan = [...new Set(eanMatches.map((x) => x.codigoInterno).filter(Boolean))];
    const codigosNome = [...new Set(nomeMatches.map((x) => x.codigoInterno).filter(Boolean))];
    return { ...p, codigosEan, codigosNome, matchEan: eanMatches.length, matchNome: nomeMatches.length };
  });
  const folhas = [];
  const client = new GoogleSheetsClient();
  for (const p of PLANILHAS) {
    const metas = await client.getSheets(p.id);
    const amostras = [];
    for (const meta of metas) {
      const last = indexToCol(Math.min(meta.columnCount - 1, 29));
      const [values] = await client.batchGetValues(p.id, [a1(meta.title, `A1:${last}${Math.min(meta.rowCount, 15)}`)], 'FORMATTED_VALUE');
      amostras.push({ ...meta, values });
    }
    folhas.push({ ...p, abas: amostras });
  }
  const resumo = {
    compilart: {
      total: itens.length,
      minCodigo: Math.min(...itens.map((x) => Number(x.codigoInterno)).filter(Number.isFinite)),
      maxCodigo: Math.max(...itens.map((x) => Number(x.codigoInterno)).filter(Number.isFinite)),
      eansUnicos: byEan.size,
      eansDuplicados: [...byEan.values()].filter((x) => new Set(x.map((y) => y.codigoInterno)).size > 1).length,
    },
    sistema: Object.fromEntries(['BASE', 'TNP', 'LI'].map((loja) => [loja, {
      total: linhas.filter((x) => x.loja === loja).length,
      eanUnico: linhas.filter((x) => x.loja === loja && x.codigosEan.length === 1).length,
      eanAmbiguo: linhas.filter((x) => x.loja === loja && x.codigosEan.length > 1).length,
      semEanComNomeUnico: linhas.filter((x) => x.loja === loja && x.codigosEan.length === 0 && x.codigosNome.length === 1).length,
      semMatch: linhas.filter((x) => x.loja === loja && x.codigosEan.length === 0 && x.codigosNome.length === 0).length,
    }])),
  };
  fs.writeFileSync(SAIDA, JSON.stringify({ resumo, folhas, linhas }, null, 2));
  console.log(JSON.stringify(resumo, null, 2));
  console.log(`Saída: ${SAIDA}`);
}

main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });
