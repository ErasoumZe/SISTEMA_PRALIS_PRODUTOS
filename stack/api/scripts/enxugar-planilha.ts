/**
 * Enxuga a GRADE da planilha: apaga as linhas vazias do fim das abas grandes.
 *
 * ── Por que ───────────────────────────────────────────────────────────────
 * Medido em 14/09/2026 por `scripts/diagnostico-planilha.ts`: a planilha de
 * produção tem 8.879.727 células (88,8% do limite de 10 milhões do Google), e
 * ler QUATRO células da aba `(TNP/LI) CADASTRO PRODUTOS` não volta em 45
 * segundos. Os metadados da mesma planilha voltam em 440 ms — não é rede nem
 * cota: é a planilha, que o Google não consegue recalcular a tempo de servir
 * qualquer valor.
 *
 * A causa é grade: cinco abas com 9.930 linhas de FÓRMULA para cerca de 1.200
 * produtos reais. São ~8.700 linhas calculando em cima de nada, vezes 231
 * colunas na maior delas.
 *
 * ── Por que ele NÃO decide sozinho onde cortar ────────────────────────────
 * Porque neste momento não há como ler a aba para conferir que o fim está
 * vazio: `values.batchGet` E `get(includeGridData)` estouram os dois. Um script
 * que escolhesse a linha de corte estaria adivinhando, e o erro apagaria
 * cadastro de verdade — sem desfazer.
 *
 * Então a linha de corte vem de FORA, conferida por quem enxerga a planilha:
 *
 *   1. abra a aba no navegador;
 *   2. Ctrl+End leva à última célula usada — anote o número da linha;
 *   3. passe esse número (com folga) em `--ate-linha`.
 *
 * Tudo daí para baixo é apagado; nada acima é tocado.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *   tsx scripts/enxugar-planilha.ts --ate-linha 2000            # só mostra
 *   tsx scripts/enxugar-planilha.ts --ate-linha 2000 --aba "(LI) CADASTRO PRODUTOS"
 *   tsx scripts/enxugar-planilha.ts --ate-linha 2000 --apply    # executa
 *
 * Sem `--apply` nada é escrito. Com `--apply`, apaga uma aba por vez, da menor
 * para a maior, imprimindo o resultado de cada uma — se a primeira já destravar
 * a leitura, dá para parar e conferir antes de seguir.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { google } from 'googleapis';

/** As abas de cadastro, que são as pesadas. Nenhuma outra é tocada. */
const ABAS_ALVO = [
  '(TNP/LI) CADASTRO PRODUTOS',
  '(REST. HORA) CADASTRO PRODUTOS',
  '(TNP) CADASTRO PRODUTOS',
  '(LI) CADASTRO PRODUTOS',
  '(HORA) CADASTRO PRODUTOS',
];

/**
 * Piso de segurança. Mesmo que alguém digite `--ate-linha 50`, o script recusa:
 * o cadastro tem ~1.200 produtos a partir da linha 11, e cortar acima disso
 * apagaria produto. Número escolhido com folga de mais de 60%.
 */
const MINIMO_ABSOLUTO = 2000;

const arg = (nome: string): string | undefined => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const aplicar = process.argv.includes('--apply');
  const ateLinha = Number(arg('ate-linha') ?? NaN);
  const sóEsta = arg('aba');

  if (!Number.isInteger(ateLinha)) {
    console.error('Falta --ate-linha N. Veja no navegador com Ctrl+End qual é a última linha usada.');
    process.exit(1);
  }
  if (ateLinha < MINIMO_ABSOLUTO) {
    console.error(
      `--ate-linha ${ateLinha} e menor que o piso de seguranca (${MINIMO_ABSOLUTO}).\n`
      + 'O cadastro comeca na linha 11 e tem cerca de 1.200 produtos. Cortar ai apagaria produto.',
    );
    process.exit(1);
  }

  const { env } = await import('@/config/env');
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  /*
   * QUAL planilha, dito em voz alta.
   *
   * O `.env` da máquina de desenvolvimento aponta para a cópia de HOMOLOGAÇÃO,
   * não para produção. Rodar isto sem olhar apagaria linha na planilha errada —
   * e apagar linha não tem desfazer. Por isso, para aplicar, é preciso repetir
   * os seis últimos caracteres do ID: quem confirma teve de ler qual é.
   */
  const id = arg('planilha') ?? env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const fim = String(id).slice(-6);
  if (aplicar && arg('confirmo') !== fim) {
    console.error(
      `Para aplicar, confirme a planilha: --confirmo ${fim}\n`
      + `(alvo atual: ...${fim}${arg('planilha') ? '' : ', vindo do .env desta maquina'})`,
    );
    process.exit(1);
  }

  /* Metadados: é a única leitura que responde hoje, e a única de que precisamos. */
  const meta = await sheets.spreadsheets.get(
    { spreadsheetId: id, fields: 'sheets.properties(sheetId,title,gridProperties)' },
    { timeout: 30000, retry: false } as never,
  );
  const todas = (meta.data.sheets ?? []).map((s) => ({
    sheetId: s.properties?.sheetId ?? -1,
    titulo: s.properties?.title ?? '',
    linhas: s.properties?.gridProperties?.rowCount ?? 0,
    colunas: s.properties?.gridProperties?.columnCount ?? 0,
  }));

  const antes = todas.reduce((s, a) => s + a.linhas * a.colunas, 0);
  console.log(`planilha ...${String(id).slice(-6)} — ${todas.length} abas`);
  console.log(`hoje: ${antes.toLocaleString('pt-BR')} celulas (${((antes / 1e7) * 100).toFixed(1)}% do limite)\n`);
  console.log(aplicar ? '=== APLICANDO ===\n' : '=== SIMULACAO — nada sera escrito ===\n');
  console.log(`linha de corte: ${ateLinha} (tudo de ${ateLinha + 1} para baixo sai)\n`);

  const alvo = todas
    .filter((a) => (sóEsta ? a.titulo === sóEsta : ABAS_ALVO.includes(a.titulo)))
    .filter((a) => a.linhas > ateLinha)
    .sort((a, b) => a.linhas * a.colunas - b.linhas * b.colunas); // da menor para a maior

  if (!alvo.length) {
    console.log('Nenhuma aba a enxugar: ou ja estao dentro do corte, ou o nome nao bate.');
    process.exit(0);
  }

  let economia = 0;
  for (const a of alvo) {
    const some = (a.linhas - ateLinha) * a.colunas;
    economia += some;
    console.log(
      `  ${a.titulo.padEnd(34)} ${a.linhas} -> ${ateLinha} linhas   `
      + `libera ${some.toLocaleString('pt-BR')} celulas`,
    );

    if (!aplicar) continue;

    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: a.sheetId,
                dimension: 'ROWS',
                startIndex: ateLinha, // 0-based: a linha `ateLinha` FICA
                endIndex: a.linhas,
              },
            },
          }],
        },
      }, { timeout: 120000, retry: false } as never);
      console.log('      OK');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`      FALHOU: ${msg.slice(0, 120)}`);
      console.log('      Parando aqui: as demais abas ficam como estao.');
      break;
    }
  }

  const depois = antes - economia;
  console.log(`\n${aplicar ? 'resultado' : 'ficaria'}: ${depois.toLocaleString('pt-BR')} celulas `
    + `(${((depois / 1e7) * 100).toFixed(1)}% do limite) — ${economia.toLocaleString('pt-BR')} a menos`);
  if (!aplicar) console.log('\nNada foi escrito. Repita com --apply quando a linha de corte estiver conferida.');
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
