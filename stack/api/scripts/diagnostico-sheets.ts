/**
 * Diagnostico da API do Google Sheets: mostra STATUS, mensagem completa e
 * tempo de cada chamada, com timeout curto para o erro aparecer em vez de
 * pendurar. So leitura.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { google } from 'googleapis';

const ANTIGA = '1itKr_GIBE7u0xCpsfM3YtzhaIFqhpVnC4pGFSj0B2nA';
const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';

async function main() {
  const { env } = await import('@/config/env');
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const tentar = async (rotulo: string, fn: () => Promise<any>) => {
    const t = Date.now();
    try {
      const r = await fn();
      const n = r?.data?.valueRanges?.[0]?.values?.length ?? r?.data?.sheets?.length ?? 0;
      console.log(`OK    ${String(Date.now() - t).padStart(6)} ms  ${rotulo}  (${n})`);
    } catch (e: any) {
      const st = e?.code ?? e?.response?.status ?? '?';
      const msg = e?.errors?.[0]?.message ?? e?.message ?? String(e);
      console.log(`FALHA ${String(Date.now() - t).padStart(6)} ms  ${rotulo}`);
      console.log(`        status ${st}`);
      console.log(`        ${String(msg).slice(0, 300)}`);
    }
  };

  const OPCOES = { timeout: 20000, retry: false } as any;

  console.log('== planilha ANTIGA (a que o .env local aponta) ==');
  await tentar('get (metadados)', () => sheets.spreadsheets.get(
    { spreadsheetId: ANTIGA, fields: 'sheets.properties.title' }, OPCOES));

  console.log('\n== planilha NOVA ==');
  await tentar('get (metadados)', () => sheets.spreadsheets.get(
    { spreadsheetId: NOVA, fields: 'sheets.properties.title' }, OPCOES));
  await tentar('coluna de IDs HT11:HT', () => sheets.spreadsheets.values.batchGet(
    { spreadsheetId: NOVA, ranges: ["'(TNP/LI) CADASTRO PRODUTOS'!HT11:HT"], valueRenderOption: 'FORMATTED_VALUE' }, OPCOES));
  await tentar('aba de ECF A2:Q4000', () => sheets.spreadsheets.values.batchGet(
    { spreadsheetId: NOVA, ranges: ["'(TNP) FISCAL - CADASTRO ECF'!A2:Q4000"], valueRenderOption: 'FORMATTED_VALUE' }, OPCOES));

  process.exit(0);
}
main().catch((e) => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
