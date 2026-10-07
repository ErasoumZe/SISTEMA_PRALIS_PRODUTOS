import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ErroHttp, lerRetryAfterMs } from "./api-client.js";
import { enviarComRetry } from "./retry.js";

const LOTE = 500;
const cancelado = (valor) => ["1", "C", "S", "SIM", "TRUE"].includes(String(valor ?? "").trim().toUpperCase());
const texto = (valor) => String(valor ?? "").trim();

// Reusa o vínculo item -> venda -> dispositivo que o agente já leu do Creare.
// Hora permanece local, como exige o contrato existente de /vendas/importar.
export function montarLinhasPralis({ vendas, itens }, empresa) {
  const porVenda = new Map(vendas.map((venda) => [texto(venda.idVendaBalcao), venda]));
  const linhas = [];
  for (const item of itens) {
    const venda = porVenda.get(texto(item.idVendaBalcao));
    if (!venda || !item.idItemVendaBalcao || !venda.dataHoraVenda) continue;
    const status = texto(venda.statusVenda).toUpperCase();
    linhas.push({
      ID_ITEM_VENDA_BALCAO: texto(item.idItemVendaBalcao),
      ID_VENDA_BALCAO: texto(venda.idVendaBalcao),
      ID_DISPOSITIVO: texto(venda.idDispositivo),
      PDV: texto(venda.nomeCaixa),
      DATA_HORA_VENDA: texto(venda.dataHoraVenda),
      PRODUTO_ID_ERP: texto(item.idProduto),
      PRODUTO_CODIGO: texto(item.codigoProduto),
      PRODUTO: texto(item.descricaoProduto) || "Produto sem descricao",
      QUANTIDADE: texto(item.quantidade ?? 0),
      VALOR_UNITARIO: texto(item.valorUnitario ?? 0),
      TOTAL: texto(item.total ?? 0),
      ITEM_CANCELADO: cancelado(item.itemCancelado) || status === "C",
      VENDA_STATUS: status,
      VENDA_CONFIRMADA: status === "F",
      EMPRESA: empresa,
      // O SIA não fornece uma data de alteração para cancelamentos. A API
      // compara o conteúdo quando esta data empata (ver teste de integração).
      // Mesma régua do runner anterior: maior hora entre venda e item. Se o
      // novo agente trouxer hora menor, o upsert da API ignora a correção.
      ATUALIZADO_EM: [texto(item.dataHoraItem), texto(venda.dataHoraVenda)].sort().at(-1),
    });
  }
  return linhas;
}

// O valor oficial do cupom e os pagamentos nao podem ser reconstruidos pela
// soma dos itens: crediario, troco, acrescimos e cancelamentos mudam a conta.
export function montarCuponsPralis({ vendas, pagamentos }, empresa) {
  const porVenda = new Map();
  for (const pagamento of pagamentos) {
    const id = texto(pagamento.idVendaBalcao);
    const lista = porVenda.get(id) ?? [];
    lista.push({
      ID_PAGAMENTO: texto(pagamento.idFormaPgtoVendaBalcao),
      ID_FORMA_PAGAMENTO: texto(pagamento.idFormaPagamento),
      FORMA_PAGAMENTO: texto(pagamento.descricaoFormaPagamento) || "Forma sem descricao",
      VALOR: texto(pagamento.valor ?? 0)
    });
    porVenda.set(id, lista);
  }
  return vendas.filter((venda) => venda.idVendaBalcao && venda.dataHoraVenda).map((venda) => ({
    ID_VENDA_BALCAO: texto(venda.idVendaBalcao),
    ID_DISPOSITIVO: texto(venda.idDispositivo),
    PDV: texto(venda.nomeCaixa),
    DATA_HORA_VENDA: texto(venda.dataHoraVenda),
    STATUS: texto(venda.statusVenda),
    VALOR_SUBTOTAL: texto(venda.valorSubtotal ?? 0),
    VALOR_DESCONTO: texto(venda.valorDesconto ?? 0),
    VALOR_ACRESCIMO: texto(venda.valorAcrescimo ?? 0),
    VALOR_TOTAL: texto(venda.valorTotal ?? 0),
    VALOR_PAGO: texto(venda.valorPago ?? 0),
    PAGAMENTOS: porVenda.get(texto(venda.idVendaBalcao)) ?? [],
    EMPRESA: empresa
  }));
}

async function lerPendentes(arquivo) {
  try {
    const conteudo = JSON.parse(await readFile(arquivo, "utf8"));
    if (!Array.isArray(conteudo)) throw new Error("Fila Pralis invalida");
    return conteudo;
  } catch (erro) {
    if (erro.code === "ENOENT") return [];
    throw erro;
  }
}

async function salvarPendentes(arquivo, linhas) {
  await mkdir(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  await writeFile(temporario, JSON.stringify(linhas), "utf8");
  await rename(temporario, arquivo);
}

export async function enviarLotePralis(config, linhas, tipo = "venda_item_pdv") {
  const resposta = await fetch(`${config.apiUrl}/vendas/importar`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ tipo, linhas })
  });
  if (!resposta.ok) {
    throw new ErroHttp(`Pralis HTTP ${resposta.status}`, {
      status: resposta.status,
      retryAfterMs: lerRetryAfterMs(resposta)
    });
  }
  return resposta.json();
}

export async function sincronizarPralis(config, filaArquivo, linhasAtuais, retry = {}, enviar = enviarLotePralis,
  { tipo = "venda_item_pdv", chave = "ID_ITEM_VENDA_BALCAO" } = {}) {
  const anteriores = await lerPendentes(filaArquivo);
  const porId = new Map([...anteriores, ...linhasAtuais].map((linha) => [linha[chave], linha]));
  const linhas = [...porId.values()];
  const pendentes = [];
  let enviados = 0;
  let erros = 0;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    try {
      await enviarComRetry(() => enviar(config, lote, tipo), retry);
      enviados += lote.length;
    } catch (erro) {
      erros += 1;
      pendentes.push(...lote);
      console.warn(`[pralis/${tipo}] lote pendente: ${erro.status ? `HTTP ${erro.status}` : "falha de rede"}`);
    }
  }
  await salvarPendentes(filaArquivo, pendentes);
  console.log(`[pralis/${tipo}] recebidos=${linhas.length} enviados=${enviados} pendentes=${pendentes.length} lotes_com_erro=${erros}`);
  return { itens: linhas.length, enviados, pendentes: pendentes.length, lotesComErro: erros };
}
