/**
 * Lê o FORMATO das células da faixa fiscal — não o valor.
 *
 * Existe para responder uma pergunta que o valor não responde: as duas colunas
 * `REDUCAO_ICMS` (`DC` e `DP`) estão vazias em todas as linhas, então não há
 * precedente de conteúdo. Mas o formato de número que a planilha aplica à
 * coluna DIZ o que ela espera receber: `0.00%` é percentual, `@` é texto,
 * `0` é inteiro.
 *
 * O mesmo vale para a origem (`AC` e `AZ` do cadastro antigo), onde os valores
 * existem e o formato confirma a leitura.
 *
 * Só leitura.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { google } from 'googleapis';

const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA_NOVA = '(TNP/LI) CADASTRO PRODUTOS';
const ANTIGA = '1itKr_GIBE7u0xCpsfM3YtzhaIFqhpVnC4pGFSj0B2nA';
const ABA_ANTIGA = 'MIX PRODUTOS LOJA E PRODUÇÃO ASSOCIAÇÃO';

async function main() {
  const { env } = await import('@/config/env');
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const mostrar = async (planilha: string, aba: string, faixa: string, rotulo: string) => {
    const res = await sheets.spreadsheets.get({
      spreadsheetId: planilha,
      ranges: [`'${aba.replace(/'/g, "''")}'!${faixa}`],
      includeGridData: true,
      fields: 'sheets.data.rowData.values(formattedValue,effectiveFormat.numberFormat,userEnteredFormat.numberFormat)',
    });
    const linhas = res.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
    console.log(`\n=== ${rotulo} — ${faixa} ===`);
    linhas.forEach((linha, i) => {
      const celulas = linha.values ?? [];
      const desc = celulas.map((c) => {
        const fmt = c.effectiveFormat?.numberFormat ?? c.userEnteredFormat?.numberFormat;
        const tipo = fmt?.type ?? '-';
        const padrao = fmt?.pattern ?? '';
        const valor = c.formattedValue ?? '';
        return `${String(valor).slice(0, 10).padEnd(11)}[${tipo}${padrao ? ' ' + padrao : ''}]`;
      });
      if (desc.some((d) => !d.startsWith('           [-'))) {
        console.log(`  L${i + 1}: ${desc.join('  ')}`);
      }
    });
  };

  // na planilha NOVA: as duas colunas REDUCAO_ICMS, vazias, com o formato
  await mostrar(NOVA, ABA_NOVA, 'DC5:DC14', 'NOVA · DC (1a REDUCAO_ICMS)');
  await mostrar(NOVA, ABA_NOVA, 'DP5:DP14', 'NOVA · DP (2a REDUCAO_ICMS)');
  await mostrar(NOVA, ABA_NOVA, 'DD5:DD14', 'NOVA · DD (ALIQUOTA CHEIA, para comparar)');

  // na ANTIGA: as mesmas duas, com valor, para confirmar a leitura
  await mostrar(ANTIGA, ABA_ANTIGA, 'AC11:AC16', 'ANTIGA · AC (REDUCAO_ICMS)');
  await mostrar(ANTIGA, ABA_ANTIGA, 'AZ11:AZ16', 'ANTIGA · AZ (REDUCAO_ICMS)');
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
