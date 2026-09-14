/**
 * Por que o sistema está lento: mede a PLANILHA, não o código.
 *
 * O que ele mostra, em ordem:
 *   1. quantas células cada planilha tem (o Google para em 10 milhões);
 *   2. quanto tempo leva ler QUATRO células (A1:B2) de cada aba grande;
 *   3. a mesma leitura numa planilha pequena, para servir de régua.
 *
 * A leitura de 4 células é de propósito: se ela demora, o problema não é o
 * tamanho da faixa que pedimos — é a planilha inteira, que o Google precisa
 * recalcular antes de devolver qualquer valor.
 *
 * Só leitura. Não grava nada, em lugar nenhum.
 *
 * Uso: tsx scripts/diagnostico-planilha.ts
 */
import 'reflect-metadata';
import 'dotenv/config';
import { google } from 'googleapis';

const PLANILHAS: Array<{ id: string; nome: string }> = [
  { id: '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw', nome: 'NOVA combinada — produção' },
  { id: '1itKr_GIBE7u0xCpsfM3YtzhaIFqhpVnC4pGFSj0B2nA', nome: 'estudo fiscal antigo — régua' },
];

/** Curto de propósito: aqui queremos o erro, não a espera. */
const OP = { timeout: 30000, retry: false } as any;

async function main() {
  const { env } = await import('@/config/env');
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  for (const { id, nome } of PLANILHAS) {
    console.log(`\n=== ${nome} (...${id.slice(-6)}) ===`);
    const meta = await sheets.spreadsheets.get(
      { spreadsheetId: id, fields: 'sheets.properties(title,gridProperties)' }, OP);
    const abas = (meta.data.sheets ?? []).map((s) => ({
      titulo: s.properties?.title ?? '',
      linhas: s.properties?.gridProperties?.rowCount ?? 0,
      colunas: s.properties?.gridProperties?.columnCount ?? 0,
    }));
    const celulas = abas.reduce((s, a) => s + a.linhas * a.colunas, 0);
    const pct = ((celulas / 10_000_000) * 100).toFixed(1);
    console.log(`${abas.length} abas · ${celulas.toLocaleString('pt-BR')} células · ${pct}% do limite do Google`);

    const maiores = [...abas].sort((a, b) => b.linhas * b.colunas - a.linhas * a.colunas).slice(0, 5);
    console.log('\n  aba                                    grade        células   ler A1:B2');
    for (const a of maiores) {
      const t = Date.now();
      let veredito: string;
      try {
        await sheets.spreadsheets.values.batchGet(
          { spreadsheetId: id, ranges: [`'${a.titulo.replace(/'/g, "''")}'!A1:B2`] }, OP);
        veredito = `${Date.now() - t} ms`;
      } catch (e: any) {
        veredito = `ESTOUROU (${Date.now() - t} ms) ${String(e?.message).slice(0, 24)}`;
      }
      console.log(
        `  ${a.titulo.slice(0, 36).padEnd(38)} ${String(a.linhas).padStart(5)}x${String(a.colunas).padEnd(4)} `
        + `${String((a.linhas * a.colunas).toLocaleString('pt-BR')).padStart(11)}   ${veredito}`,
      );
    }
  }

  console.log('\nLeitura de 4 células acima de ~1 s significa planilha pesada demais:');
  console.log('cada salvamento do sistema faz leitura + escrita nela.');
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.message ?? e); process.exit(1); });
