/**
 * Confere as 12 equivalências de grupo decididas por código de barras.
 *
 * O que DÁ para conferir aqui: se o código existe no cadastro do SIA e se o
 * nome de lá bate com a justificativa escrita na decisão. Isso valida a metade
 * verificável — "este código é mesmo este produto".
 *
 * O que NÃO dá: o grupo oficial. O export do SIA nesta planilha tem só
 * descrição, código do produto e código de barras — não traz grupo. Ou seja, o
 * passo "produto → grupo oficial" é julgamento humano registrado, não dado
 * copiado. É a diferença que o relatório precisa dizer com todas as letras.
 *
 * Só leitura.
 *
 * Uso: tsx scripts/conferir-12-decisoes.ts
 */
import 'reflect-metadata';
import 'dotenv/config';
import { google } from 'googleapis';

const ABAS_SIA = ['BASE FULL SIA TNP', 'BASE FULL SIA LI'];

/** Mesma normalização do casamento por código: só dígitos, sem zero à esquerda. */
const chave = (v: string): string => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/** Compara nomes ignorando acento, pontuação e caixa. */
const simplificar = (v: string): string => String(v ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

async function main() {
  const { env } = await import('@/config/env');
  const { GRUPOS_LEGADOS_POR_BARRAS } = await import('@/modules/apoio/grupos-legados');
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const OP = { timeout: 60000, retry: false } as never;

  /** código (de barras OU interno) -> nomes encontrados */
  const porCodigo = new Map<string, string[]>();
  for (const aba of ABAS_SIA) {
    const [faixa] = (await sheets.spreadsheets.values.batchGet(
      {
        spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
        ranges: [`'${aba}'!A1:C20000`],
        valueRenderOption: 'FORMATTED_VALUE',
      },
      OP,
    )).data.valueRanges ?? [];
    const linhas = (faixa?.values ?? []) as string[][];
    console.log(`${aba}: ${linhas.length} linhas`);
    for (const [nome = '', cod = '', barras = ''] of linhas) {
      for (const c of [cod, barras]) {
        const k = chave(c);
        if (!k) continue;
        const lista = porCodigo.get(k) ?? [];
        lista.push(String(nome).trim());
        porCodigo.set(k, lista);
      }
    }
  }

  console.log('\n=== conferencia das 12 ===\n');
  let confirmados = 0;
  const duvidas: string[] = [];

  for (const [barras, e] of Object.entries(GRUPOS_LEGADOS_POR_BARRAS)) {
    const citado = simplificar(String(e.por).replace(/^auditoria SIA:\s*/i, ''));
    const nomes = [...new Set((porCodigo.get(chave(barras)) ?? []).map(simplificar))];
    const bate = nomes.some((n) => n === citado || n.startsWith(citado) || citado.startsWith(n));

    const marca = nomes.length === 0 ? 'SEM REGISTRO' : bate ? 'confere' : 'NOME DIFERENTE';
    if (bate) confirmados += 1;
    else duvidas.push(barras);

    console.log(`${marca.padEnd(14)} ${barras.padEnd(15)} ${e.legado} -> ${e.oficial}`);
    console.log(`               decisao cita : ${citado}`);
    console.log(`               SIA diz      : ${nomes.length ? nomes.slice(0, 3).join(' | ') : '(nao encontrado)'}`);
    console.log('');
  }

  console.log(`codigo confere com o nome citado: ${confirmados}/12`);
  if (duvidas.length) console.log(`a olhar: ${duvidas.join(', ')}`);
  console.log('\nATENCAO: o export do SIA nesta planilha NAO tem coluna de grupo.');
  console.log('Logo, "produto -> grupo oficial" e decisao humana registrada, nao dado copiado.');
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
