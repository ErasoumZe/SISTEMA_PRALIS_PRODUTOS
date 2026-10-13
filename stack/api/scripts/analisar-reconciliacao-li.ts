import 'reflect-metadata';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { GoogleSheetsClient, a1 } from '@/modules/google-sheets/google-sheets.client';

const ARQUIVO_COMPILART = String.raw`C:\Users\José\Downloads\produtos_pralis_convertidos-compilart.xlsx`;
const EXPORTACAO = String.raw`C:\Users\José\Downloads\produtos-20260918.csv`;
const PLANILHA = '1xoPA6FqhLgix0cQSiyEgX56sO_X8QErz-9aZtrkGZAY';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';
const SAIDA = path.resolve(process.cwd(), '../../../tmp/codigo-interno-auditoria/plano-li.json');

const texto = (v: unknown) => String(v ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
const digitos = (v: unknown) => texto(v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const codigo = (v: unknown) => digitos(v).padStart(5, '0');

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
  const wb = XLSX.readFile(ARQUIVO_COMPILART, { raw: false });
  const catalogo = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Produtos, { defval: '' }).map((r) => ({
    codigo: codigo(r['Cód. Interno']), ean: digitos(r['Código Produto Padrão']), nome: texto(r['Descrição']), ativo: texto(r.Ativo), pagina: texto(r['Página PDF']),
  }));
  const porEan = new Map<string, typeof catalogo>();
  for (const x of catalogo) if (x.ean) porEan.set(x.ean, [...(porEan.get(x.ean) ?? []), x]);

  const todos = parseCsv(fs.readFileSync(EXPORTACAO, 'utf8'));
  const bases = new Map(todos.filter((r) => r.loja === 'BASE').map((r) => [r.id, r]));
  const li = todos.filter((r) => r.loja === 'LI').map((r) => {
    const matches = porEan.get(digitos(r.codigo_barras)) ?? [];
    const destinos = [...new Set(matches.map((x) => x.codigo))];
    return { id: r.id, baseProductId: r.base_product_id, nome: r.nome, ean: digitos(r.codigo_barras), atual: codigo(r.codigo_interno), destinos, origem: matches };
  });
  const alvos = new Map<string, typeof li>();
  for (const p of li) if (p.destinos.length === 1) alvos.set(p.destinos[0]!, [...(alvos.get(p.destinos[0]!) ?? []), p]);
  const atuais = new Map(li.map((p) => [p.atual, p]));

  const client = new GoogleSheetsClient();
  const [nomes, eans, tnpCodes, liCodes, ids] = await client.batchGetValues(PLANILHA, [
    a1(ABA, 'D11:D9930'), a1(ABA, 'F11:F9930'), a1(ABA, 'X11:X9930'), a1(ABA, 'BN11:BN9930'), a1(ABA, 'HT11:HT9930'),
  ], 'FORMATTED_VALUE');
  const linhaPorBaseId = new Map<string, { linha: number; nome: string; ean: string; tnp: string; li: string }>();
  for (let i = 0; i < 9920; i += 1) {
    const id = texto(ids[i]?.[0]);
    if (id) linhaPorBaseId.set(id, { linha: i + 11, nome: texto(nomes[i]?.[0]), ean: digitos(eans[i]?.[0]), tnp: codigo(tnpCodes[i]?.[0]), li: codigo(liCodes[i]?.[0]) });
  }

  const plano = li.map((p) => {
    const destino = p.destinos.length === 1 ? p.destinos[0]! : '';
    const duplicadoNoSistema = destino ? (alvos.get(destino)?.length ?? 0) > 1 : false;
    const donoAtual = destino ? atuais.get(destino) : undefined;
    const colisaoComNaoMapeado = !!donoAtual && donoAtual.id !== p.id && donoAtual.destinos.length !== 1;
    const base = bases.get(p.baseProductId);
    const sheet = linhaPorBaseId.get(p.baseProductId);
    const apto = !!destino && !duplicadoNoSistema && !colisaoComNaoMapeado && !!base && !!sheet;
    let motivo = 'apto';
    if (!destino) motivo = p.destinos.length > 1 ? 'EAN ambiguo no Compilart' : 'EAN ausente no Compilart';
    else if (duplicadoNoSistema) motivo = 'mais de um produto LI aponta para o mesmo codigo Compilart';
    else if (colisaoComNaoMapeado) motivo = 'codigo destino ainda pertence a produto LI sem correspondencia';
    else if (!base) motivo = 'copia LI sem produto BASE';
    else if (!sheet) motivo = 'produto BASE sem linha identificada na planilha oficial';
    return { ...p, destino, apto, motivo, base: base ? { id: base.id, nome: base.nome, codigoInterno: codigo(base.codigo_interno) } : null, planilha: sheet ?? null };
  });

  const resumo = {
    catalogoCompilart: catalogo.length,
    maxCodigoCompilart: Math.max(...catalogo.map((x) => Number(x.codigo))),
    produtosLi: li.length,
    eanDestinoUnico: plano.filter((x) => x.destino).length,
    aptos: plano.filter((x) => x.apto).length,
    jaCorretos: plano.filter((x) => x.apto && x.atual === x.destino).length,
    alteracoes: plano.filter((x) => x.apto && x.atual !== x.destino).length,
    bloqueadosPorMotivo: Object.fromEntries([...new Set(plano.filter((x) => !x.apto).map((x) => x.motivo))].map((m) => [m, plano.filter((x) => x.motivo === m).length])),
    linhasIdentificadasPlanilha: linhaPorBaseId.size,
  };
  fs.writeFileSync(SAIDA, JSON.stringify({ resumo, plano }, null, 2));
  console.log(JSON.stringify(resumo, null, 2));
  console.log(`Saída: ${SAIDA}`);
}

main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });
