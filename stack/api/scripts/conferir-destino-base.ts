/**
 * Das colunas que o espelho da BASE escreve, quais tem destino na planilha
 * NOVA? So leitura.
 *
 * O espelho escreve por LETRA fixa, montado para o leiaute antigo. Na planilha
 * nova as mesmas letras significam outra coisa — ligar assim gravaria gramatura
 * dentro do codigo de barras. A saida daqui e o de-para que falta.
 */
import 'reflect-metadata';
import 'dotenv/config';

const ANTIGA = '1C0FsFMZelHN1Il3xmoI7E5EStgr_8MpgYz0aJ-X2y2w';
const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA_NOVA = '(TNP/LI) CADASTRO PRODUTOS';

/** Mesmo campo, nome diferente nas duas planilhas. Inferido da linha de dados. */
const APELIDOS: Record<string, string> = {
  'A/I': 'V',                                   // C='INATIVO' na linha 11 da nova
  NOME: 'CADASTRO PRODUTOS ATUALIZADO NOVO',    // a nova nao tem coluna NOME
  QT_CAD: 'QT',                                 // J='21,00' na nova
};

const letra = (i: number): string => { let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

async function main() {
  const { env } = await import('@/config/env');
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const { normalizarCabecalho } = await import('@/modules/google-sheets/sheet-traducao');
  const { INPUT_COLUMNS } = await import('@/modules/google-sheets/product-sheet.mapper');
  const c = new GoogleSheetsClient();

  const ler = async (id: string, aba: string) => {
    env.GOOGLE_SHEETS_SPREADSHEET_ID = id;
    const [v] = await c.batchGetValues(id, [a1(aba, 'A5:IZ5')], 'FORMATTED_VALUE');
    return (((v ?? [])[0] ?? []) as string[]).map(normalizarCabecalho);
  };

  const antiga = await ler(ANTIGA, '(BASE) CADASTRO PRODUTOS');
  const nova = await ler(NOVA, ABA_NOVA);
  const colunaNaNova = new Map<string, string>();
  nova.forEach((n, i) => { if (n && !colunaNaNova.has(n)) colunaNaNova.set(n, letra(i)); });

  const achados: string[] = [];
  const faltando: string[] = [];

  for (const col of INPUT_COLUMNS) {
    const idx = col.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const nome = antiga[idx] ?? '';
    if (!nome) { faltando.push(`${col.padStart(3)}  (sem cabecalho na antiga)`); continue; }
    const alvo = colunaNaNova.get(nome) ?? colunaNaNova.get(APELIDOS[nome] ?? '');
    const via = colunaNaNova.get(nome) ? '' : ` (via apelido "${APELIDOS[nome]}")`;
    if (alvo) achados.push(`${col.padStart(3)} ${nome.slice(0, 36).padEnd(38)} -> ${alvo}${via}`);
    else faltando.push(`${col.padStart(3)} ${nome.slice(0, 46)}`);
  }

  console.log(`COM DESTINO (${achados.length}):`);
  achados.forEach((x) => console.log('  ' + x));
  console.log(`\nSEM DESTINO (${faltando.length}) — precisam de decisao sua:`);
  faltando.forEach((x) => console.log('  ' + x));
  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
