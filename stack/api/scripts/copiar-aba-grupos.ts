/**
 * Copia o conteúdo da aba de GRUPOS/REF. da planilha anterior para a oficial.
 *
 * Irmão de `copiar-aba-fiscal.ts`, com uma diferença que muda o método: lá a
 * aba NÃO existia no destino e era criada; aqui ela existe e está VAZIA. Por
 * isso não há `addSheet` — só escrita dentro da aba que já está lá, e uma
 * recusa firme se ela tiver qualquer conteúdo.
 *
 * O sistema lê apenas `M5:N130` daqui (grupo + margem %), mas a cópia leva a
 * aba inteira: as outras colunas são as listas de validação que a própria
 * planilha usa nos menus suspensos. Copiar só o pedaço que o código lê
 * consertaria o Pralis e deixaria a planilha quebrada para quem a edita.
 *
 * Copia VALORES, não fórmulas: as fórmulas apontam para abas da planilha de
 * origem e viriam quebradas. É tabela de consulta — o valor é o que importa.
 *
 * Conferência por padrão; grava só com `--gravar`.
 *
 * Uso:  cd stack/api && npx tsx scripts/copiar-aba-grupos.ts [--gravar]
 */
import 'reflect-metadata';
import 'dotenv/config';

/* Onde o conteúdo vivo está hoje. O destino sai do ambiente, nunca fixo. */
const ANTIGA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';

const ATE_COLUNA = 'AK';
const ATE_LINHA = 1451;
/** A faixa que o `TaxRuleService` lê de verdade — é ela que precisa chegar. */
const FAIXA_MARGENS = 'M5:N130';

async function main() {
  const gravar = process.argv.includes('--gravar');
  const { env } = await import('@/config/env');
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();

  const ABA = env.GOOGLE_SHEETS_GRUPOS_TAB;
  const NOVA = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!NOVA) {
    console.log('GOOGLE_SHEETS_SPREADSHEET_ID vazio — sem destino, nao gravo nada.');
    process.exit(1);
  }
  if (NOVA === ANTIGA) {
    console.log('destino igual a origem — nada a fazer.');
    process.exit(1);
  }

  console.log(gravar ? '=== GRAVANDO ===' : '=== CONFERENCIA (nada sera gravado) ===');
  console.log(`  aba    : ${ABA}`);
  console.log(`  origem : ${ANTIGA}`);
  console.log(`  destino: ${NOVA}`);

  const abas = await c.getSheets(NOVA);
  if (!abas.some((a) => a.title === ABA)) {
    console.log(`\n  a aba "${ABA}" nao existe no destino — este script so PREENCHE.`);
    process.exit(1);
  }

  /*
   * Recusa se o destino tiver conteúdo. Este script existe para preencher uma
   * aba vazia; sobrescrever uma aba já preenchida apagaria o que alguém pôs
   * ali, e não há como distinguir "veio vazia da cópia" de "o José ajustou".
   */
  /*
   * `#REF!` e companhia NÃO são conteúdo — são o buraco deixado por uma fórmula
   * que quebrou. A aba de grupos da planilha oficial chegou exatamente assim,
   * com um `#REF!` sozinho em A1: a planilha foi criada por cópia e a fórmula
   * que trazia os dados perdeu a origem. Contar isso como "já tem conteúdo"
   * faria o script se recusar a consertar justamente o caso que ele existe
   * para consertar.
   */
  const ERRO_DE_FORMULA = /^#(REF|N\/A|VALUE|NAME|DIV\/0|NULL|NUM|ERROR)[!?]?$/i;
  const vazio = (v: unknown) => {
    const t = String(v ?? '').trim();
    return t === '' || ERRO_DE_FORMULA.test(t);
  };

  const [jaTem] = await c.batchGetValues(NOVA, [a1(ABA, `A1:${ATE_COLUNA}${ATE_LINHA}`)], 'FORMATTED_VALUE');
  const destino = (jaTem ?? []) as string[][];
  const ocupadas = destino.filter((l) => (l ?? []).some((v) => !vazio(v))).length;
  if (ocupadas > 0) {
    console.log(`\n  o destino JA tem ${ocupadas} linhas com conteudo — nao sobrescrevo.`);
    console.log('  Se a intencao e mesmo substituir, limpe a aba antes, de proposito.');
    process.exit(1);
  }
  const comErro = destino.reduce(
    (n, l) => n + (l ?? []).filter((v) => String(v ?? '').trim() !== '' && vazio(v)).length,
    0,
  );
  console.log(comErro
    ? `  destino: aba vazia, com ${comErro} celula(s) de formula quebrada que serao substituidas`
    : '  destino: aba encontrada e vazia');

  const [valores] = await c.batchGetValues(ANTIGA, [a1(ABA, `A1:${ATE_COLUNA}${ATE_LINHA}`)], 'FORMATTED_VALUE');
  const linhas = (valores ?? []) as string[][];
  const comConteudo = linhas.filter((l) => (l ?? []).some((v) => String(v ?? '').trim() !== '')).length;
  console.log(`  lidas  : ${linhas.length} linhas, ${comConteudo} com conteudo`);

  /* A prova de que a cópia serve: as margens que o sistema vai ler. */
  const [margens] = await c.batchGetValues(ANTIGA, [a1(ABA, FAIXA_MARGENS)], 'FORMATTED_VALUE');
  const pares = ((margens ?? []) as string[][])
    .filter((l) => String((l ?? [])[0] ?? '').trim() !== '' && String((l ?? [])[1] ?? '').trim() !== '');
  console.log(`  margens: ${pares.length} grupos em ${FAIXA_MARGENS}`);
  pares.slice(0, 5).forEach(([g, m]) => console.log(`     ${String(g).slice(0, 28).padEnd(28)} ${m}`));

  if (!gravar) process.exit(0);
  if (comConteudo === 0) {
    console.log('\n  !! a origem veio vazia — nao gravo aba vazia por cima de aba vazia');
    process.exit(1);
  }

  // em blocos: um update com 1.450 linhas de 37 colunas estoura o limite
  const BLOCO = 300;
  for (let i = 0; i < linhas.length; i += BLOCO) {
    const pedaco = linhas.slice(i, i + BLOCO).map((l) => (l ?? []).map((v) => String(v ?? '')));
    if (!pedaco.length) break;
    await c.batchUpdateValues(
      NOVA,
      [{ range: a1(ABA, `A${i + 1}:${ATE_COLUNA}${i + pedaco.length}`), values: pedaco }],
      'RAW',
    );
    console.log(`  gravadas linhas ${i + 1}..${i + pedaco.length}`);
  }

  console.log('\n  aba preenchida');
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
