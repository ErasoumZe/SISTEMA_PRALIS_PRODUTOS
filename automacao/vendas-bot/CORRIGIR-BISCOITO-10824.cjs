// Copiar para a RAIZ do "bot produtos" no PC da padaria. Nao toca na planilha.
// Sem --aplicar: somente consulta. Com --aplicar: atualiza UMA linha diaria no Pralis.
const fs = require('fs');
const path = require('path');

const DIA = '15/09/2026';
const DATA_CONSULTA = '2026-09-15';
const CODIGO = '10824';
const QUANTIDADE_ESPERADA = 1.114;
const TOTAL_ESPERADO = 96.80;

function selecionarLinha(rows) {
  const encontradas = rows.filter((row) =>
    String(row.DATA_VENDA).trim() === DIA &&
    String(row.PRODUTO_CODIGO ?? '').replace(/^0+/, '') === CODIGO &&
    String(row.PRODUTO ?? '').toUpperCase().includes('BISCOITO POLVILHO CEBOLA'));
  if (encontradas.length !== 1) throw new Error(`Esperada uma linha para ${DIA}/10824; encontradas ${encontradas.length}. Nao aplicar.`);
  const linha = encontradas[0];
  if (Math.abs(Number(linha.QUANTIDADE) - QUANTIDADE_ESPERADA) > 0.001 ||
      Math.abs(Number(linha.TOTAL) - TOTAL_ESPERADO) > 0.01) {
    throw new Error(`Total mudou: quantidade=${linha.QUANTIDADE}, total=${linha.TOTAL}. Nao aplicar sem nova conferencia.`);
  }
  return linha;
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--aplicar')) throw new Error('Uso: node CORRIGIR-BISCOITO-10824.cjs [--aplicar]');
  const queryPath = path.join(__dirname, 'queries', 'CREARE_COMPILART_ITENS_VENDAS_DIARIAS.sql');
  const query = fs.readFileSync(queryPath, 'utf8');
  if (!query.includes("vb.STATUS = 'F'") || !query.includes('ivb.ITEM_CANCELADO')) {
    throw new Error('Instale primeiro o SQL corrigido de vendas diarias; consulta antiga bloqueada.');
  }
  const { loadConfig } = require('./services/configService');
  const { loadEnvForConfig } = require('./services/envService');
  const { createDatabaseService } = require('./services/databaseService');
  const { runQuery } = require('./services/queryService');
  const { mapVendaProduto } = require('./services/syncService');
  const { normalizeRecord } = require('./services/recordService');
  const { formatDateTime } = require('./services/dateService');
  const { PralisSalesService } = require('./services/pralisSalesService');
  const config = loadConfig();
  loadEnvForConfig(config);
  if (config.empresa !== 'TNP CENTRAL') throw new Error('A correcao e exclusiva da TNP.');
  const db = createDatabaseService('CREARE_COMPILART');
  let rows;
  try {
    rows = await runQuery(db, 'CREARE_COMPILART_ITENS_VENDAS_DIARIAS.sql', DATA_CONSULTA);
  } finally {
    await db.close();
  }
  const linha = selecionarLinha(rows);
  console.log(`[biscoito] PREVIA ${DIA}, codigo=${CODIGO}, quantidade=${linha.QUANTIDADE}, total=R$ ${linha.TOTAL}.`);
  if (!process.argv.includes('--aplicar')) {
    console.log('[biscoito] Somente leitura. Nada enviado. Para corrigir UMA linha no Pralis, repita com --aplicar.');
    return;
  }
  const sales = new PralisSalesService();
  if (!sales.isEnabled()) throw new Error('Destino Pralis do bot sem URL/token. Nao aplicar.');
  const mapped = mapVendaProduto(linha, { automationName: 'CREARE_COMPILART', config, now: formatDateTime() });
  const record = normalizeRecord(config.sheets.VENDAS_PRODUTOS, mapped);
  const resposta = await sales.sendRecords('VENDAS_PRODUTOS', [record]);
  if (resposta.sent !== 1 || resposta.pending !== 0) {
    throw new Error(`Envio nao confirmado: enviados=${resposta.sent}, pendentes=${resposta.pending}. Ver .runtime/pralis-pending; nao apagar.`);
  }
  console.log('[biscoito] Um agregado diario enviado ao Pralis. Confira o ranking e a fonte do periodo.');
}

if (require.main === module) main().catch((erro) => { console.error(`[biscoito] ${erro.message}`); process.exitCode = 1; });
module.exports = { selecionarLinha };
