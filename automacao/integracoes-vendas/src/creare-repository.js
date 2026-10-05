import { carregarQuery } from "./query-loader.js";

async function executar(pool, arquivo, parametros = []) {
  const sql = await carregarQuery(arquivo);
  const [linhas] = await pool.execute(sql, parametros);
  return linhas;
}

export async function buscarUltimoDiaComDados(pool) {
  const [linha] = await executar(pool, "ultimo-dia-com-dados.sql");
  return linha?.dataOrigem ?? null;
}

// Agregado do dia por dispositivo (PDV) para a conciliacao: so venda fechada (STATUS='F').
// Os valores vem do MySQL como string/decimal; a API compara em centavos.
export async function buscarConciliacaoDia(pool, dataOrigem) {
  const linhas = await executar(pool, "conciliacao-dia.sql", [dataOrigem, dataOrigem]);
  return linhas.map((linha) => ({
    pdvIdentificador: String(linha.pdvIdentificador),
    quantidadeVendas: Number(linha.quantidadeVendas ?? 0),
    valorTotal: Number(linha.valorTotal ?? 0)
  }));
}

// Uma linha por venda FECHADA do dia (mesmo filtro do agregado da conciliacao), por PDV. Alimenta o
// diagnostico "presente no CREARE, ausente no sistema": a API cruza esses IDs com o que recebeu.
export async function buscarIdsVendasFechadasDia(pool, dataOrigem) {
  const linhas = await executar(pool, "conciliacao-ids-dia.sql", [dataOrigem, dataOrigem]);
  return linhas.map((linha) => ({
    pdvIdentificador: String(linha.pdvIdentificador),
    idVendaBalcao: String(linha.idVendaBalcao)
  }));
}

export async function buscarVendasDia(pool, dataOrigem) {
  const intervaloDia = [dataOrigem, dataOrigem];
  const [vendas, itens, pagamentos] = await Promise.all([
    executar(pool, "vendas-dia.sql", intervaloDia),
    executar(pool, "itens-dia.sql", intervaloDia),
    executar(pool, "pagamentos-dia.sql", intervaloDia)
  ]);

  return { vendas, itens, pagamentos };
}

// Rele exclusivamente vendas hoje marcadas como CANCELADAS em uma janela de datas de venda. O
// CREARE registra o status atual na mesma venda, mas esta instalacao nao possui uma coluna confiavel
// de "data do cancelamento". Esta varredura separada impede que uma venda de outro dia, cancelada
// agora, fique esquecida para sempre pelo reprocesso normal do dia corrente.
export async function buscarVendasCanceladasDesde(pool, dataInicial, dataFinal) {
  const vendas = await executar(pool, "vendas-canceladas-intervalo.sql", [dataInicial, dataFinal]);
  const ids = normalizarIds(vendas.map((venda) => venda.idVendaBalcao));
  if (!ids.length) return { vendas: [], itens: [], pagamentos: [] };

  const [itens, pagamentos] = await Promise.all([
    executarPorIds(pool, "itens-ids.sql", ids),
    executarPorIds(pool, "pagamentos-ids.sql", ids)
  ]);
  return { vendas, itens, pagamentos };
}

// Normaliza uma lista de IDs de venda (string "1,2,3" ou array) para inteiros positivos unicos, na
// ordem informada. Lanca em qualquer token nao-numerico — usado tanto na validacao do CLI quanto na
// leitura por IDs, para nunca montar SQL com entrada suja (os IDs vao como parametros, nunca no texto).
export function normalizarIds(entrada) {
  const bruto = Array.isArray(entrada) ? entrada : String(entrada ?? "").split(",");
  const vistos = new Set();
  const ids = [];
  for (const item of bruto) {
    const token = String(item).trim();
    if (!token) continue;
    if (!/^\d+$/.test(token)) throw new Error(`ID de venda invalido: "${token}" (use apenas numeros).`);
    const numero = Number(token);
    if (!vistos.has(numero)) {
      vistos.add(numero);
      ids.push(numero);
    }
  }
  return ids;
}

// Carrega uma query "-ids.sql" e expande o marcador /*IDS*/ em N placeholders (?, ?, ...), passando
// os IDs como parametros da prepared statement — a lista variavel de IN () fica parametrizada, sem
// interpolar valor no SQL.
async function executarPorIds(pool, arquivo, ids) {
  const sql = (await carregarQuery(arquivo)).replace("/*IDS*/", ids.map(() => "?").join(", "));
  const [linhas] = await pool.execute(sql, ids);
  return linhas;
}

// Le vendas especificas por ID_VENDA_BALCAO (independentemente do dia). itens/pagamentos vem so das
// vendas pedidas; o montador de payload agrupa por venda. IDs sem venda correspondente simplesmente
// nao voltam — quem chama compara com o pedido para avisar os ausentes.
export async function buscarVendasPorIds(pool, entradaIds) {
  const ids = normalizarIds(entradaIds);
  if (!ids.length) return { vendas: [], itens: [], pagamentos: [] };
  const [vendas, itens, pagamentos] = await Promise.all([
    executarPorIds(pool, "vendas-ids.sql", ids),
    executarPorIds(pool, "itens-ids.sql", ids),
    executarPorIds(pool, "pagamentos-ids.sql", ids)
  ]);

  return { vendas, itens, pagamentos };
}

// Lista de dias "YYYY-MM-DD" de de..ate (inclusive). Ancorada em UTC (strings de data sao neutras
// de fuso); pura e testavel. Se ate < de, retorna [].
export function enumerarDias(deYMD, ateYMD) {
  const dias = [];
  const atual = new Date(`${deYMD}T00:00:00Z`);
  const fim = new Date(`${ateYMD}T00:00:00Z`);
  while (atual <= fim) {
    dias.push(atual.toISOString().slice(0, 10));
    atual.setUTCDate(atual.getUTCDate() + 1);
  }
  return dias;
}

// "YYYY-MM-DD" de n dias antes de `ymd`. Ancorado em UTC (data neutra de fuso); puro.
export function subtrairDias(ymd, n) {
  const data = new Date(`${ymd}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() - n);
  return data.toISOString().slice(0, 10);
}

// Conjunto de dias (YYYY-MM-DD, ordenado) que o ciclo reprocessa POR COMPLETO. O cursor (ultimoDia)
// e apenas otimizacao, nunca fonte de verdade: o dia corrente inteiro SEMPRE entra, entao uma venda
// que o PDV sincronizou tarde (DTHR anterior ao ultimo cursor) e capturada no ciclo seguinte.
//  - sempre o dia corrente inteiro;
//  - 1a execucao (sem cursor): backfill de `diasIniciais` dias;
//  - virada de dia (cursor != hoje): tambem o dia anterior, uma vez (retardatarios da virada).
// Nao cobre buracos de varios dias (agente parado dias): para isso existe o reprocesso em faixa.
export function diasParaProcessar(hoje, ultimoDia, diasIniciais = 1) {
  const dias = new Set([hoje]);
  if (!ultimoDia) {
    for (const dia of enumerarDias(subtrairDias(hoje, Math.max(1, diasIniciais) - 1), hoje)) dias.add(dia);
  } else if (ultimoDia !== hoje) {
    dias.add(subtrairDias(hoje, 1));
  }
  return [...dias].sort();
}

// Data inicial inclusiva da janela de cancelamentos. Mantida pura para que a janela seja testavel
// e para nunca depender do relogio da maquina nos testes.
export function inicioJanelaCancelamentos(hoje, diasCancelamentos = 90) {
  const dias = Math.max(1, Math.floor(Number(diasCancelamentos) || 1));
  return subtrairDias(hoje, dias - 1);
}

// Dia contabil no fuso do NEGOCIO (nao o da maquina): a API deriva data_referencia com a mesma
// regra (shared/src/datas), entao os dois lados da conciliacao usam a mesma regua mesmo se o
// agente rodar num host/container em UTC. Espelha diaNegocio() do shared — este pacote e standalone
// (JS puro, sem dependencia do shared), por isso a duplicacao consciente.
const formatadorDiaNegocio = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function diaNegocioHoje() {
  return formatadorDiaNegocio.format(new Date());
}

// Le varios dias (inclusive) e junta vendas/itens/pagamentos. O montador de payload seleciona
// itens/pagamentos por venda. Reprocessar dias ja enviados e barato e seguro (o servidor deduplica
// por idVenda + hash). Base do ciclo (dia corrente + retardatarios) e do reprocesso em faixa.
export async function buscarVendasDias(pool, dias) {
  const vendas = [];
  const itens = [];
  const pagamentos = [];
  for (const dia of dias) {
    const dados = await buscarVendasDia(pool, dia);
    vendas.push(...dados.vendas);
    itens.push(...dados.itens);
    pagamentos.push(...dados.pagamentos);
  }
  return { vendas, itens, pagamentos };
}
