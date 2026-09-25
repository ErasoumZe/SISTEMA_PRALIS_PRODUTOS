/**
 * rodar-vendas-ao-vivo.js
 * =====================================================================
 * Manda ao Pralis as VENDAS ITEM A ITEM (lote `venda_item_pdv`) e sai.
 *
 * E um caminho SEPARADO do robo diario (index.js / rodar-uma-vez.js), de
 * proposito: aquele grava planilha, calcula data pela planilha e roda uma
 * vez por noite. Este nao toca na planilha, le so os ultimos dias do Creare
 * e envia direto ao Pralis. Pode rodar a cada minuto sem mexer no que ja
 * funciona.
 *
 * O servidor guarda uma linha por (loja, ID_ITEM_VENDA_BALCAO): reenviar o
 * mesmo item nao duplica; ATUALIZADO_EM mais novo corrige.
 *
 * Uso manual:   node rodar-vendas-ao-vivo.js
 * Agendado:     rodar-vendas-ao-vivo.bat (Agendador de Tarefas, a cada minuto)
 * Dias lidos:   variavel AO_VIVO_DIAS (padrao 1 = hoje e ontem)
 * =====================================================================
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./services/configService');
const { loadEnvForConfig } = require('./services/envService');
const { createDatabaseService } = require('./services/databaseService');
const { runQuery } = require('./services/queryService');
const { withLock } = require('./services/lockService');
const salesModule = require('./services/pralisSalesService');

const QUERY = 'CREARE_COMPILART_ITENS_VENDA_PDV.sql';
const TIPO = 'venda_item_pdv';
const LOTE = 500;
const LOG = path.join(__dirname, 'logs', 'ao-vivo.txt');

const PralisSalesService = salesModule.PralisSalesService || salesModule.default || salesModule;

function log(linha) {
  const texto = `[${new Date().toISOString()}] ${linha}`;
  console.log(texto);
  try { fs.appendFileSync(LOG, texto + '\n'); } catch { /* log e conveniencia */ }
}

/** `aaaa-mm-dd` de N dias atras, pelo relogio local da maquina da loja. */
function dataHaDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const booleano = (v) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

/** A linha como o `POST /vendas/importar` espera: tudo texto, IDs sem perder precisao. */
function paraLinha(row, empresa) {
  return {
    ID_ITEM_VENDA_BALCAO: String(row.ID_ITEM_VENDA_BALCAO ?? ''),
    ID_VENDA_BALCAO: String(row.ID_VENDA_BALCAO ?? ''),
    ID_DISPOSITIVO: String(row.ID_DISPOSITIVO ?? ''),
    PDV: String(row.PDV ?? ''),
    DATA_HORA_VENDA: String(row.DATA_HORA_VENDA ?? ''),
    PRODUTO_ID_ERP: String(row.PRODUTO_ID_ERP ?? ''),
    PRODUTO_CODIGO: String(row.PRODUTO_CODIGO ?? ''),
    PRODUTO: String(row.PRODUTO ?? ''),
    QUANTIDADE: String(row.QUANTIDADE ?? '0'),
    VALOR_UNITARIO: String(row.VALOR_UNITARIO ?? '0'),
    TOTAL: String(row.TOTAL ?? '0'),
    ITEM_CANCELADO: booleano(row.ITEM_CANCELADO),
    VENDA_STATUS: String(row.VENDA_STATUS ?? ''),
    VENDA_CONFIRMADA: booleano(row.VENDA_CONFIRMADA),
    EMPRESA: empresa,
    ATUALIZADO_EM: String(row.ATUALIZADO_EM ?? ''),
  };
}

async function executar() {
  const config = loadConfig();
  loadEnvForConfig(config);

  const sales = new PralisSalesService({ batchSize: LOTE });
  if (!sales.isEnabled()) {
    throw new Error('PRALIS_VENDAS_API_URL / PRALIS_VENDAS_API_TOKEN nao configurados no .env.');
  }

  const dias = Math.max(0, Number(process.env.AO_VIVO_DIAS ?? 1));
  const dataReferencia = dataHaDias(dias);
  const db = createDatabaseService('CREARE_COMPILART');
  try {
    const rows = await runQuery(db, QUERY, dataReferencia);
    log(`${config.empresa}: lidos=${rows.length} itens desde ${dataReferencia}`);
    if (rows.length === 0) return { lidos: 0, lotes: 0 };

    const linhas = rows
      .map((r) => paraLinha(r, config.empresa))
      // sem os dois IDs nao ha vinculo comprovado: o servidor recusaria a linha inteira
      .filter((l) => l.ID_ITEM_VENDA_BALCAO && l.ID_VENDA_BALCAO);

    let lotes = 0;
    let inseridas = 0;
    let atualizadas = 0;
    let ignoradas = 0;
    for (let i = 0; i < linhas.length; i += LOTE) {
      const resposta = await sales.post({ tipo: TIPO, linhas: linhas.slice(i, i + LOTE) });
      lotes += 1;
      const r = resposta && resposta.data ? resposta.data : resposta || {};
      inseridas += Number(r.inseridas || 0);
      atualizadas += Number(r.atualizadas || 0);
      ignoradas += Number(r.ignoradas || 0);
    }
    log(`Pralis/${TIPO}: lotes=${lotes}, inseridas=${inseridas}, atualizadas=${atualizadas}, ignoradas=${ignoradas}`);
    return { lidos: rows.length, lotes, inseridas, atualizadas, ignoradas };
  } finally {
    await db.close();
  }
}

(async () => {
  try {
    // o mesmo cadeado do robo diario: nunca dois processos lendo o Creare ao mesmo tempo
    await withLock(executar);
    process.exit(0);
  } catch (erro) {
    log(`FALHOU: ${erro.stack || erro.message}`);
    process.exit(1);
  }
})();
