/**
 * diagnostico-fechamento-pagamentos.js
 * =====================================================================
 * SOMENTE LEITURA. Descobre por que o fechamento de caixa chega ao Pralis
 * quase vazio (diagnóstico de 28/10/2026, nota 43 do cofre PRALIS).
 *
 * O que já se sabe, de fora:
 *  - o robô manda o fechamento a cada minuto, mas com 4 a 8 vendas por dia,
 *    quando a loja faz ~1.400 (os itens chegam inteiros);
 *  - em 08/10/2026 o fechamento de 06/10 estava certo (R$ 21.871, 1.433
 *    vendas) e hoje está R$ 57, 6 vendas: foi REESCRITO depois;
 *  - o ano de 2026 inteiro foi reescrito, a partir de 01/01/2026 — que é o
 *    VALOR_DATA_DEFAULT do config. O robô relê desde essa data quando não
 *    acha a última data na planilha.
 *
 * Este script responde, no PC da padaria:
 *  1. o banco ainda tem os pagamentos em `formapgto_venda_balcao`? Desde
 *     quando faltam? (vendas x vendas com pagamento, mês a mês)
 *  2. se faltam, em que OUTRA tabela eles estão agora (tabelas candidatas,
 *     com as colunas, e quantas vendas de ontem cada uma cobre)
 *  3. quem roda o robô e com que frequência (tarefas agendadas do Windows,
 *     data padrão, dias de reprocesso e o fim dos logs)
 *
 * NÃO escreve nada no banco, na planilha nem no Pralis. Não imprime senha:
 * usa as mesmas credenciais do robô (.env) sem mostrá-las.
 *
 * USO: copie para a pasta do robô (C:\Users\Server-Pralis\Documents\bot) e
 *   node diagnostico-fechamento-pagamentos.js
 * Gera diagnostico-fechamento-AAAAMMDD-HHMM.txt na mesma pasta. Mande esse
 * arquivo de volta.
 * =====================================================================
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mysql = require('mysql2');
const { loadConfig } = require('./services/configService');
const { loadEnvForConfig } = require('./services/envService');
const { createDatabaseService } = require('./services/databaseService');

const linhas = [];
const escrever = (texto = '') => { console.log(texto); linhas.push(texto); };
const titulo = (texto) => { escrever(''); escrever('='.repeat(70)); escrever(texto); escrever('='.repeat(70)); };
const tabela = (rows) => {
  if (!rows || !rows.length) { escrever('  (nenhuma linha)'); return; }
  const cols = Object.keys(rows[0]);
  const larg = cols.map((c) => Math.min(40, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))));
  escrever('  ' + cols.map((c, i) => c.padEnd(larg[i])).join(' | '));
  escrever('  ' + larg.map((l) => '-'.repeat(l)).join('-+-'));
  for (const r of rows) escrever('  ' + cols.map((c, i) => String(r[c] ?? '').slice(0, 40).padEnd(larg[i])).join(' | '));
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const diasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

async function consultar(db, rotulo, sql) {
  try {
    return await db.query(sql);
  } catch (erro) {
    escrever(`  ERRO em "${rotulo}": ${erro.code || ''} ${erro.message}`);
    return null;
  }
}

/** Vendas fechadas x vendas que têm pagamento em formapgto_venda_balcao, num dia. */
async function coberturaDoDia(db, dia) {
  const d = mysql.escape(dia);
  const rows = await consultar(db, `cobertura ${dia}`, `
    SELECT ${d} AS dia,
           COUNT(*) AS vendas_fechadas,
           ROUND(SUM(vb.VALOR_TOTAL), 2) AS valor_vendas,
           SUM(EXISTS (SELECT 1 FROM formapgto_venda_balcao f WHERE f.ID_VENDA_BALCAO = vb.ID_VENDA_BALCAO)) AS vendas_com_pagamento,
           ROUND((SELECT COALESCE(SUM(f.VALOR_LIQUIDO), 0)
                    FROM formapgto_venda_balcao f
                    JOIN venda_balcao v2 ON v2.ID_VENDA_BALCAO = f.ID_VENDA_BALCAO
                   WHERE v2.DTHR_VENDABALCAO >= ${d} AND v2.DTHR_VENDABALCAO < DATE_ADD(${d}, INTERVAL 1 DAY)
                     AND v2.STATUS = 'F'), 2) AS valor_pagamentos
      FROM venda_balcao vb
     WHERE vb.DTHR_VENDABALCAO >= ${d} AND vb.DTHR_VENDABALCAO < DATE_ADD(${d}, INTERVAL 1 DAY)
       AND vb.STATUS = 'F'`);
  return rows ? rows[0] : null;
}

async function main() {
  const config = loadConfig();
  loadEnvForConfig(config);
  const db = createDatabaseService('CREARE_COMPILART');

  titulo(`DIAGNÓSTICO DO FECHAMENTO — ${config.empresa} — ${new Date().toLocaleString('pt-BR')}`);
  escrever(`VALOR_DATA_DEFAULT = ${config.dataDefault}   DIAS_REPROCESSAR = ${config.diasReprocessar}`);
  escrever(`Pralis ligado: ${process.env.PRALIS_VENDAS_API_URL ? 'sim' : 'NÃO'} (URL e token não são impressos)`);

  try {
    const info = await consultar(db, 'versao', 'SELECT VERSION() AS versao_mysql, DATABASE() AS banco, NOW() AS agora_no_banco');
    tabela(info);

    titulo('1) Os pagamentos ainda estão em formapgto_venda_balcao? (dias de amostra)');
    escrever('  Se vendas_com_pagamento for bem menor que vendas_fechadas, o pagamento foi para outro lugar.');
    const dias = ['2025-10-15', '2026-06-15', '2026-10-06', diasAtras(7), diasAtras(1), iso(new Date())];
    const cobertura = [];
    for (const dia of dias) {
      const linha = await coberturaDoDia(db, dia);
      if (linha) cobertura.push(linha);
    }
    tabela(cobertura);

    titulo('2) Mês a mês desde set/2025: vendas x vendas com pagamento');
    tabela(await consultar(db, 'mensal', `
      SELECT DATE_FORMAT(vb.DTHR_VENDABALCAO, '%Y-%m') AS mes,
             COUNT(*) AS vendas_fechadas,
             SUM(EXISTS (SELECT 1 FROM formapgto_venda_balcao f WHERE f.ID_VENDA_BALCAO = vb.ID_VENDA_BALCAO)) AS com_pagamento
        FROM venda_balcao vb
       WHERE vb.DTHR_VENDABALCAO >= '2025-09-01' AND vb.STATUS = 'F'
       GROUP BY 1 ORDER BY 1`));

    titulo('3) Últimos registros de formapgto_venda_balcao (quando pararam de entrar?)');
    tabela(await consultar(db, 'ultimos pagamentos', `
      SELECT f.ID_FORMAPGTO_VENDABALCAO AS id_pagamento, f.ID_VENDA_BALCAO AS id_venda,
             vb.DTHR_VENDABALCAO AS hora_da_venda, f.ID_FORMAPGTO AS forma, f.VALOR_LIQUIDO AS valor
        FROM formapgto_venda_balcao f
        LEFT JOIN venda_balcao vb ON vb.ID_VENDA_BALCAO = f.ID_VENDA_BALCAO
       ORDER BY f.ID_FORMAPGTO_VENDABALCAO DESC LIMIT 10`));
    tabela(await consultar(db, 'tamanho', `
      SELECT TABLE_NAME AS tabela, TABLE_ROWS AS linhas_aprox, CREATE_TIME AS criada, UPDATE_TIME AS alterada
        FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('formapgto_venda_balcao', 'venda_balcao', 'item_venda_balcao')`));

    titulo('4) Tabelas candidatas a guardar o pagamento hoje');
    escrever('  Toda tabela com coluna ID_VENDA_BALCAO, ou com PAG/PGTO/TEF/RECEB/FINALIZ no nome.');
    const candidatas = await consultar(db, 'candidatas', `
      SELECT t.TABLE_NAME AS tabela, t.TABLE_ROWS AS linhas_aprox, t.CREATE_TIME AS criada, t.UPDATE_TIME AS alterada,
             MAX(c.COLUMN_NAME = 'ID_VENDA_BALCAO') AS tem_id_venda
        FROM information_schema.TABLES t
        JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
       WHERE t.TABLE_SCHEMA = DATABASE()
       GROUP BY t.TABLE_NAME, t.TABLE_ROWS, t.CREATE_TIME, t.UPDATE_TIME
      HAVING tem_id_venda = 1
          OR UPPER(t.TABLE_NAME) REGEXP 'PAG|PGTO|TEF|RECEB|FINALIZ'
       ORDER BY t.UPDATE_TIME DESC
       LIMIT 40`);
    tabela(candidatas);

    titulo(`5) Quanto das vendas de ONTEM (${diasAtras(1)}) cada candidata cobre`);
    const ontem = mysql.escape(diasAtras(1));
    for (const c of (candidatas || []).filter((x) => Number(x.tem_id_venda) === 1).slice(0, 25)) {
      const nome = mysql.escapeId(c.tabela);
      const r = await consultar(db, c.tabela, `
        SELECT COUNT(*) AS linhas, COUNT(DISTINCT t.ID_VENDA_BALCAO) AS vendas_cobertas
          FROM ${nome} t
          JOIN venda_balcao vb ON vb.ID_VENDA_BALCAO = t.ID_VENDA_BALCAO
         WHERE vb.DTHR_VENDABALCAO >= ${ontem} AND vb.DTHR_VENDABALCAO < DATE_ADD(${ontem}, INTERVAL 1 DAY)
           AND vb.STATUS = 'F'`);
      if (r) escrever(`  ${String(c.tabela).padEnd(40)} linhas=${r[0].linhas}  vendas_cobertas=${r[0].vendas_cobertas}`);
    }

    titulo('6) Colunas das candidatas (para escrever a consulta nova)');
    for (const c of (candidatas || []).slice(0, 25)) {
      const cols = await consultar(db, `colunas ${c.tabela}`, `
        SELECT GROUP_CONCAT(CONCAT(COLUMN_NAME, ':', DATA_TYPE) ORDER BY ORDINAL_POSITION SEPARATOR ', ') AS colunas
          FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${mysql.escape(c.tabela)}`);
      escrever(`  ${c.tabela}: ${cols?.[0]?.colunas ?? '?'}`);
    }

    titulo('7) Formas de pagamento cadastradas');
    tabela(await consultar(db, 'formas', 'SELECT ID_FORMAPGTO AS id, DESCRICAO AS forma FROM forma_pagamento ORDER BY ID_FORMAPGTO'));
  } finally {
    await db.close();
  }

  titulo('8) Quem roda o robô (Agendador de Tarefas do Windows)');
  try {
    const saida = execSync('schtasks /Query /FO LIST /V', { encoding: 'latin1', maxBuffer: 32 * 1024 * 1024 });
    const blocos = saida.split(/\r?\n\r?\n/).filter((b) => /bot|padaria|pralis|vendas|creare/i.test(b));
    for (const bloco of blocos) {
      for (const l of bloco.split(/\r?\n/)) {
        if (/^(Nome da tarefa|TaskName|Tarefa a ser executada|Task To Run|Status|Hora da .ltima execu|Last Run Time|.ltimo resultado|Last Result|Repetir: a cada|Repeat: Every|Tipo de agendamento|Schedule Type|Hora de in.cio|Start Time)/i.test(l.trim())) {
          escrever('  ' + l.trim());
        }
      }
      escrever('  ---');
    }
    if (!blocos.length) escrever('  nenhuma tarefa com bot/padaria/pralis/vendas/creare no nome');
  } catch (erro) {
    escrever(`  não consegui listar as tarefas: ${erro.message}`);
  }

  titulo('9) Fim dos logs do robô');
  for (const nome of ['logs/agendado.txt', 'logs/ao-vivo.txt', 'logs/ao-vivo-agendado.txt']) {
    const arquivo = path.join(__dirname, nome);
    escrever(`--- ${nome}`);
    if (!fs.existsSync(arquivo)) { escrever('  (não existe)'); continue; }
    const fim = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).slice(-25);
    for (const l of fim) escrever('  ' + l.replace(/(senha|password|token)\S*/gi, '$1=***'));
  }
  const ultimoSync = fs.existsSync(path.join(__dirname, 'logs'))
    ? fs.readdirSync(path.join(__dirname, 'logs')).filter((n) => n.endsWith('-sync.log')).sort().at(-1)
    : null;
  if (ultimoSync) {
    escrever(`--- logs/${ultimoSync} (último sync)`);
    for (const l of fs.readFileSync(path.join(__dirname, 'logs', ultimoSync), 'utf8').split(/\r?\n/).slice(0, 40)) {
      escrever('  ' + l.replace(/(senha|password|token)\S*/gi, '$1=***'));
    }
  }

  const agora = new Date();
  const carimbo = `${iso(agora).replace(/-/g, '')}-${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}`;
  const destino = path.join(__dirname, `diagnostico-fechamento-${carimbo}.txt`);
  fs.writeFileSync(destino, linhas.join('\r\n'), 'utf8');
  console.log(`\nPronto. Mande este arquivo de volta: ${destino}`);
}

main().catch((erro) => {
  console.error(`FALHOU: ${erro.stack || erro.message}`);
  process.exit(1);
});
