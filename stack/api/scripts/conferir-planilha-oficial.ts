/**
 * Conferência da planilha OFICIAL de cadastro, antes de ligar a escrita.
 *
 * Por que este script existe
 * --------------------------
 * Todo o mapeamento do leiaute novo (`leiaute-planilha-nova.ts`) foi levantado
 * e provado contra a planilha `1iQGit…`. Em 16/09/2026 o José apontou o destino
 * oficial para OUTRO arquivo, `1xoPA6…`. As duas podem ter o mesmo leiaute —
 * mas "podem" não é prova, e escrever cadastro numa planilha cujo leiaute
 * ninguém conferiu grava cada campo na coluna errada, silenciosamente.
 *
 * Além do cadastro, a MESMA planilha responde por mais duas abas: a fiscal e a
 * de grupos (`tax-rule.service.ts` lê as duas pelo mesmo `SPREADSHEET_ID`).
 * Trocar o arquivo sem que elas existam lá derruba a classificação fiscal.
 *
 * Este script é SÓ LEITURA. Não escreve nada, em planilha nenhuma.
 *
 * Uso:  cd stack/api && npx tsx scripts/conferir-planilha-oficial.ts
 */
import 'reflect-metadata';
import 'dotenv/config';

const ok = (t: string) => console.log(`  OK    ${t}`);
const falha = (t: string) => console.log(`  FALHA ${t}`);
const aviso = (t: string) => console.log(`  ~     ${t}`);

async function main() {
  const { env } = await import('@/config/env');
  const { GoogleSheetsClient, a1, indexToCol } = await import('@/modules/google-sheets/google-sheets.client');
  const { lerLeiaute, colunaDoCampo, traduzirParaPlanilhaNova, CAMPO_DA_COLUNA } =
    await import('@/modules/google-sheets/leiaute-planilha-nova');

  const id = env.GOOGLE_SHEETS_SPREADSHEET_ID;
  console.log('Conta de serviço :', env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '(não configurada)');
  console.log('Planilha         :', id || '(não configurada)');
  console.log('Aba de cadastro  :', env.GOOGLE_SHEETS_BASE_TAB);
  console.log('Aba fiscal       :', env.GOOGLE_SHEETS_FISCAL_TAB);
  console.log('Aba de grupos    :', env.GOOGLE_SHEETS_GRUPOS_TAB);
  console.log('');

  if (!id) {
    falha('GOOGLE_SHEETS_SPREADSHEET_ID vazio — nada a conferir.');
    process.exitCode = 1;
    return;
  }

  const sheets = new GoogleSheetsClient();
  let abas;
  try {
    abas = await sheets.getSheets(id);
  } catch (e: unknown) {
    const erro = e as { code?: number; message?: string };
    const codigo = erro?.code ?? 0;
    falha(`não consegui ler a planilha (${codigo || '?'}): ${erro?.message ?? String(e)}`);
    console.log('');
    /*
     * 403 e 429 são problemas DIFERENTES e o conselho errado custa tempo:
     * em 16/09/2026 o script mandou "compartilhe a planilha" para um 429, logo
     * depois de a planilha já ter sido compartilhada. 429 significa que a
     * chamada PASSOU da autorização — o acesso está certo, o que faltou foi
     * cota. Tratar os dois como a mesma coisa esconde justamente o progresso.
     */
    if (codigo === 429) {
      console.log('  Isto NÃO é falta de permissão: a chamada passou da autorização e');
      console.log('  esbarrou na cota de leituras por minuto. Quem consome essa cota é a');
      console.log('  API em produção — a carga da unificação lê a planilha inteira.');
      console.log('  Espere um minuto e rode de novo. Se repetir sempre, veja quantas');
      console.log('  cargas estão sendo disparadas em paralelo.');
    } else if (codigo === 403 || codigo === 404) {
      console.log('  Compartilhe a planilha como EDITOR com a conta de serviço acima');
      console.log('  e rode este script de novo. Enquanto isto falhar, a escrita do');
      console.log('  cadastro não funciona — e o Pralis recusa em vez de fingir.');
    } else {
      console.log('  Falha inesperada. Confira as credenciais da conta de serviço e a');
      console.log('  conectividade antes de mexer no compartilhamento.');
    }
    process.exitCode = 1;
    return;
  }

  console.log('ACESSO');
  ok(`leitura liberada — ${abas.length} abas`);
  console.log('');

  console.log('ABAS QUE O SISTEMA PRECISA');
  const titulos = abas.map((a) => a.title);
  const exigir = (rotulo: string, titulo: string): boolean => {
    if (titulos.includes(titulo)) { ok(`${rotulo}: "${titulo}"`); return true; }
    falha(`${rotulo}: "${titulo}" NÃO existe nesta planilha`);
    return false;
  };
  let tudoCerto = true;
  const temBase = exigir('cadastro', env.GOOGLE_SHEETS_BASE_TAB);
  const temFiscal = exigir('fiscal  ', env.GOOGLE_SHEETS_FISCAL_TAB);
  const temGrupos = exigir('grupos  ', env.GOOGLE_SHEETS_GRUPOS_TAB);
  tudoCerto = temBase && temFiscal && temGrupos;
  console.log('');

  /*
   * Aba existir não é aba servir.
   *
   * Em 16/09/2026 este script deu OK para a aba de grupos porque ela existia —
   * e ela estava INTEIRAMENTE vazia, sem as margens por grupo. Conferir só o
   * nome transforma "a planilha nova veio sem o conteúdo" num OK verde, que é
   * pior do que não ter conferido: dá confiança onde não havia.
   */
  console.log('CONTEUDO DAS ABAS DE APOIO');
  const contar = async (aba: string, faixa: string, rotulo: string, minimo: number) => {
    const [r] = await sheets.batchGetValues(id, [a1(aba, faixa)], 'FORMATTED_VALUE');
    const linhas = (r ?? []).filter((l) => String((l ?? [])[0] ?? '').trim() !== '').length;
    if (linhas >= minimo) { ok(`${rotulo}: ${linhas} linhas`); return true; }
    falha(`${rotulo}: ${linhas} linhas — esperava ao menos ${minimo}. A aba existe e está vazia.`);
    return false;
  };
  if (temFiscal) {
    // as quatro faixas que o TaxRuleService lê; sem a de grupos ele lança 503
    tudoCerto = await contar(env.GOOGLE_SHEETS_FISCAL_TAB, 'AB4:AG79', 'regras por grupo ', 1) && tudoCerto;
    tudoCerto = await contar(env.GOOGLE_SHEETS_FISCAL_TAB, 'A4:E2000', 'regras por produto', 1) && tudoCerto;
  }
  if (temGrupos) {
    // margem padrão por grupo: alimenta o preenchimento automático do formulário
    tudoCerto = await contar(env.GOOGLE_SHEETS_GRUPOS_TAB, 'M5:N130', 'margens por grupo ', 1) && tudoCerto;
  }
  console.log('');
  console.log('  Todas as abas do arquivo:');
  for (const a of abas) console.log(`    - "${a.title}" (${a.rowCount}x${a.columnCount})`);
  console.log('');

  if (!temBase) {
    falha('sem a aba de cadastro não dá para conferir o leiaute.');
    process.exitCode = 1;
    return;
  }

  const aba = abas.find((a) => a.title === env.GOOGLE_SHEETS_BASE_TAB)!;
  const ultima = indexToCol(Math.max(0, aba.columnCount - 1));
  const [faixasRange, cabecalhoRange, amostra] = await sheets.batchGetValues(
    id,
    [
      a1(aba.title, `A3:${ultima}3`),
      a1(aba.title, `A5:${ultima}5`),
      a1(aba.title, `A11:${ultima}60`),
    ],
    'FORMATTED_VALUE',
  );
  const linhaFaixas = (faixasRange?.[0] ?? []) as string[];
  const cabecalhos = (cabecalhoRange?.[0] ?? []) as string[];

  console.log('LEIAUTE DA ABA DE CADASTRO');
  const temFaixas = linhaFaixas.some((x) => String(x ?? '').trim() !== '');
  if (!temFaixas) {
    falha('linha 3 vazia — o código trataria esta aba como o leiaute ANTIGO,');
    falha('que escreve por posição fixa. Nesta planilha isso grava tudo torto.');
    tudoCerto = false;
  } else {
    ok(`linha 3 traz as faixas — leiaute NOVO detectado (${new Set(linhaFaixas.filter(Boolean)).size} faixas)`);
  }

  const leiaute = lerLeiaute(linhaFaixas, cabecalhos, indexToCol);
  const colId = colunaDoCampo(leiaute, 'ID', indexToCol);
  const colNome = colunaDoCampo(leiaute, 'CADASTRO PRODUTOS ATUALIZADO NOVO', indexToCol);

  /*
   * O `ID` é o que impede a duplicação: sem ele o espelho não reencontra a
   * linha do produto e cria outra a cada sincronismo.
   */
  if (colId) ok(`coluna ID na ${colId}`);
  else { falha('sem coluna ID — cada sincronismo criaria uma linha nova do mesmo produto'); tudoCerto = false; }
  if (colNome) ok(`coluna do nome na ${colNome}`);
  else { falha('sem a coluna "CADASTRO PRODUTOS ATUALIZADO NOVO"'); tudoCerto = false; }

  const dados = (amostra ?? []) as string[][];
  const preenchidas = dados.filter((l) => l.some((c) => String(c ?? '').trim() !== '')).length;
  ok(`linhas 11..60: ${preenchidas} com conteúdo (amostra)`);
  console.log('');

  /*
   * Sonda o tradutor com TODOS os campos que o mapper sabe produzir e mostra
   * quais não teriam destino nesta aba. Campo sem destino não é escrito — some
   * sem erro, e é exatamente esse silêncio que a conferência precisa quebrar.
   */
  console.log('CAMPOS DO CADASTRO SEM DESTINO NESTA ABA');
  const sonda = Object.fromEntries(
    Object.keys(CAMPO_DA_COLUNA).map((letra) => [letra, { valor: 'x' }]),
  ) as Parameters<typeof traduzirParaPlanilhaNova>[0];
  const t = traduzirParaPlanilhaNova(sonda, leiaute, null, indexToCol);
  if (t.semDestino.length === 0) ok('todos os campos da BASE têm coluna nesta aba');
  else {
    for (const campo of t.semDestino) falha(`sem coluna: ${campo}`);
    tudoCerto = false;
  }
  if (t.adiadosParaALoja.length) {
    aviso(`${t.adiadosParaALoja.length} campos só existem nas faixas de loja (normal na BASE):`);
    aviso(`  ${t.adiadosParaALoja.join(', ')}`);
  }
  console.log('');

  console.log(tudoCerto
    ? 'RESULTADO: planilha oficial CONFERIDA — pode ligar a escrita.'
    : 'RESULTADO: há pendências acima. NÃO ligue a escrita antes de resolvê-las.');
  if (!tudoCerto) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
