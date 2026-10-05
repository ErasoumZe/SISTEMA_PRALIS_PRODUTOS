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

export async function enviarLotePralis(config, linhas) {
  const resposta = await fetch(`${config.apiUrl}/vendas/importar`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ tipo: "venda_item_pdv", linhas })
  });
  if (!resposta.ok) {
    throw new ErroHttp(`Pralis HTTP ${resposta.status}`, {
      status: resposta.status,
      retryAfterMs: lerRetryAfterMs(resposta)
    });
  }
  return resposta.json();
}

export async function sincronizarPralis(config, filaArquivo, linhasAtuais, retry = {}, enviar = enviarLotePralis) {
  const anteriores = await lerPendentes(filaArquivo);
  const porId = new Map([...anteriores, ...linhasAtuais].map((linha) => [linha.ID_ITEM_VENDA_BALCAO, linha]));
  const linhas = [...porId.values()];
  const pendentes = [];
  let enviados = 0;
  let erros = 0;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    try {
      await enviarComRetry(() => enviar(config, lote), retry);
      enviados += lote.length;
    } catch (erro) {
      erros += 1;
      pendentes.push(...lote);
      console.warn(`[pralis] lote pendente: ${erro.status ? `HTTP ${erro.status}` : "falha de rede"}`);
    }
  }
  await salvarPendentes(filaArquivo, pendentes);
  console.log(`[pralis] itens=${linhas.length} enviados=${enviados} pendentes=${pendentes.length} lotes_com_erro=${erros}`);
  return { itens: linhas.length, enviados, pendentes: pendentes.length, lotesComErro: erros };
}
