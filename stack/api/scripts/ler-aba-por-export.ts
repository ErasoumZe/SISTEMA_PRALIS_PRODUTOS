/**
 * Lê uma aba pelo EXPORT do Drive, não pela API de valores do Sheets.
 *
 * Por que existe: na planilha de produção, `values.batchGet` e
 * `get(includeGridData)` estouram os dois — até para quatro células. Mas o
 * export (`/export?format=csv&gid=...`) é outro caminho inteiro no Google: ele
 * serve o arquivo, não o resultado de um recálculo sob demanda. Quando o de
 * valores morre, este costuma continuar de pé.
 *
 * Serve para responder a pergunta que trava tudo: ATÉ QUE LINHA existe dado de
 * verdade nas abas grandes. Sem isso, enxugar a grade seria adivinhar.
 *
 * Só leitura: baixa e conta. Não escreve nada, nem na planilha nem em disco
 * além do CSV que você pedir com `--salvar`.
 *
 * Uso:
 *   tsx scripts/ler-aba-por-export.ts --aba "(TNP/LI) CADASTRO PRODUTOS"
 *   tsx scripts/ler-aba-por-export.ts --todas
 *   tsx scripts/ler-aba-por-export.ts --aba "..." --salvar /caminho/saida.csv
 */
import 'reflect-metadata';
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { google } from 'googleapis';

const PADRAO = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';

/** As abas de cadastro, que são as pesadas e as que interessam enxugar. */
const ABAS_GRANDES = [
  '(TNP/LI) CADASTRO PRODUTOS',
  '(REST. HORA) CADASTRO PRODUTOS',
  '(TNP) CADASTRO PRODUTOS',
  '(LI) CADASTRO PRODUTOS',
  '(HORA) CADASTRO PRODUTOS',
];

const arg = (nome: string): string | undefined => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/**
 * Divide CSV respeitando aspas — uma célula de cadastro tem vírgula com
 * frequência (`CAIXA C/3 LADOS "U" 3P`), e quebrar por vírgula crua contaria
 * linha e coluna errado.
 */
const linhasDoCsv = (csv: string): string[][] => {
  const linhas: string[][] = [];
  let celula = '';
  let linha: string[] = [];
  let entreAspas = false;
  for (let i = 0; i < csv.length; i += 1) {
    const c = csv[i];
    if (entreAspas) {
      if (c === '"') {
        if (csv[i + 1] === '"') { celula += '"'; i += 1; } else entreAspas = false;
      } else celula += c;
      continue;
    }
    if (c === '"') { entreAspas = true; continue; }
    if (c === ',') { linha.push(celula); celula = ''; continue; }
    if (c === '\n') { linha.push(celula); linhas.push(linha); linha = []; celula = ''; continue; }
    if (c === '\r') continue;
    celula += c;
  }
  if (celula !== '' || linha.length) { linha.push(celula); linhas.push(linha); }
  return linhas;
};

async function main() {
  const { env } = await import('@/config/env');
  const id = arg('planilha') ?? PADRAO;

  /*
   * Escopo de LEITURA em drive e sheets: o export passa pelo Drive, e o token
   * do JWT do Sheets sozinho não serve para a URL de export.
   */
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
  const { token } = await auth.getAccessToken();
  if (!token) throw new Error('Nao consegui token da conta de servico.');

  /*
   * Metadados em CACHE, de propósito.
   *
   * A cota de leitura do Sheets é por MINUTO e por usuário, e a conta de
   * serviço é uma só — compartilhada com a API em produção. Refazer a chamada
   * de metadados a cada execução deste script queimava cota que a padaria
   * precisa para salvar produto. O gid de uma aba não muda; ler uma vez basta.
   */
  type Aba = { gid: number; titulo: string; linhas: number; colunas: number };
  const cache = join(tmpdir(), `pralis-abas-${id.slice(-6)}.json`);
  let abas: Aba[];
  if (existsSync(cache) && !process.argv.includes('--reler-metadados')) {
    abas = JSON.parse(readFileSync(cache, 'utf8')) as Aba[];
    console.log(`(metadados do cache: ${cache})`);
  } else {
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get(
      { spreadsheetId: id, fields: 'sheets.properties(sheetId,title,gridProperties)' },
      { timeout: 30000, retry: false } as never,
    );
    abas = (meta.data.sheets ?? []).map((s) => ({
      gid: s.properties?.sheetId ?? -1,
      titulo: s.properties?.title ?? '',
      linhas: s.properties?.gridProperties?.rowCount ?? 0,
      colunas: s.properties?.gridProperties?.columnCount ?? 0,
    }));
    writeFileSync(cache, JSON.stringify(abas, null, 2), 'utf8');
  }

  const pedidas = process.argv.includes('--todas')
    ? abas.filter((a) => ABAS_GRANDES.includes(a.titulo))
    : abas.filter((a) => a.titulo === arg('aba'));

  if (!pedidas.length) {
    console.error(`Aba nao encontrada. Disponiveis:\n${abas.map((a) => `  ${a.titulo}`).join('\n')}`);
    process.exit(1);
  }

  for (const aba of pedidas) {
    const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${aba.gid}`;
    const inicio = Date.now();

    /*
     * O export desta planilha é INTERMITENTE: a mesma aba baixa em 6 s numa
     * tentativa e estoura em 180 s na seguinte, e às vezes volta HTTP 500. É
     * coerente com o diagnóstico — o Google está no limite para servir este
     * arquivo. Insistir algumas vezes resolve; desistir na primeira transforma
     * "quase sempre dá" em "nunca dá".
     */
    let csv = '';
    let ultimoErro = '';
    for (let tentativa = 1; tentativa <= 4 && !csv; tentativa += 1) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(300000),
        });
        if (!res.ok) { ultimoErro = `HTTP ${res.status} ${res.statusText}`; continue; }
        csv = await res.text();
      } catch (e: unknown) {
        ultimoErro = e instanceof Error ? e.message : String(e);
      }
      if (!csv) console.log(`  tentativa ${tentativa} de ${aba.titulo}: ${ultimoErro}`);
    }
    if (!csv) {
      console.log(`FALHOU  ${aba.titulo}: ${ultimoErro}`);
      continue;
    }

    const linhas = linhasDoCsv(csv);
    /* A última linha com QUALQUER célula não vazia — é a resposta do Ctrl+End. */
    let ultimaComDado = 0;
    for (let i = 0; i < linhas.length; i += 1) {
      if ((linhas[i] ?? []).some((c) => String(c).trim() !== '')) ultimaComDado = i + 1;
    }

    console.log(`\n=== ${aba.titulo} ===`);
    console.log(`  baixado em ${((Date.now() - inicio) / 1000).toFixed(1)} s · ${(csv.length / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  grade declarada : ${aba.linhas} linhas x ${aba.colunas} colunas`);
    console.log(`  linhas no export: ${linhas.length}`);
    console.log(`  ULTIMA COM DADO : ${ultimaComDado}`);
    console.log(`  vazias no fim   : ${aba.linhas - ultimaComDado}`);

    if (arg('salvar') && pedidas.length === 1) {
      writeFileSync(arg('salvar')!, csv, 'utf8');
      console.log(`  salvo em ${arg('salvar')}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
