/**
 * Lista os INTERVALOS NOMEADOS da planilha.
 *
 * Existe para responder o que decide o conserto: as listas gigantes que moram
 * dentro das abas de cadastro (coluna B, ~9.100 nomes) são só sobra, ou são
 * fonte de validação/menu suspenso? Se um intervalo nomeado aponta para elas,
 * mexer sem cuidado quebra os menus de todo mundo.
 *
 * É METADADO, não valor — por isso responde rápido mesmo com a planilha no
 * limite, que é justamente onde a API de valores morre.
 *
 * Só leitura.
 *
 * Uso: tsx scripts/intervalos-nomeados.ts [--planilha <id>]
 */
import 'reflect-metadata';
import 'dotenv/config';
import { google } from 'googleapis';

const PADRAO = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';

const arg = (nome: string): string | undefined => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** 0 -> A, 26 -> AA */
const coluna = (i: number): string => {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    out = String.fromCharCode(65 + resto) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

async function main() {
  const { env } = await import('@/config/env');
  const id = arg('planilha') ?? PADRAO;
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get(
    { spreadsheetId: id, fields: 'namedRanges,sheets.properties(sheetId,title)' },
    { timeout: 30000, retry: false } as never,
  );

  const titulo = new Map<number, string>();
  for (const s of meta.data.sheets ?? []) {
    titulo.set(s.properties?.sheetId ?? -1, s.properties?.title ?? '');
  }

  const nomeados = meta.data.namedRanges ?? [];
  console.log(`planilha ...${id.slice(-6)} — ${nomeados.length} intervalos nomeados\n`);

  for (const n of nomeados) {
    const r = n.range ?? {};
    const aba = titulo.get(r.sheetId ?? -1) ?? `sheetId ${r.sheetId}`;
    const c1 = r.startColumnIndex != null ? coluna(r.startColumnIndex) : '';
    const c2 = r.endColumnIndex != null ? coluna(r.endColumnIndex - 1) : '';
    const l1 = r.startRowIndex != null ? r.startRowIndex + 1 : '';
    const l2 = r.endRowIndex != null ? r.endRowIndex : '';
    const quantas = (Number(l2 || 0) - Number(l1 || 1) + 1) || 0;
    console.log(
      `  ${String(n.name).padEnd(28)} ${aba.slice(0, 34).padEnd(36)} `
      + `${c1}${l1}:${c2}${l2}   ${quantas > 1 ? `${quantas} linhas` : ''}`,
    );
  }

  console.log('\nO que procurar: nomeado apontando para a coluna B (ou E) de uma aba de');
  console.log('CADASTRO significa que a lista mora dentro da aba pesada e alimenta menu.');
  console.log('Nesse caso, mover a lista para uma aba leve exige repontar o nomeado —');
  console.log('e aí os menus continuam funcionando.');
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
