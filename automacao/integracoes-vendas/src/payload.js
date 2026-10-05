function dinheiro(valor) {
  const numero = Number(valor ?? 0);
  return Number.isFinite(numero) ? Number(numero.toFixed(2)) : 0;
}

function texto(valor, fallback) {
  const normalizado = valor == null ? "" : String(valor).trim();
  return normalizado || fallback;
}

function textoOpcional(valor) {
  const normalizado = valor == null ? "" : String(valor).trim();
  return normalizado || null;
}

function dataHojeLocal() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function trocarDataPreservandoHora(dataHoraOrigem, dataDestino) {
  const hora = String(dataHoraOrigem).split(" ")[1] ?? "00:00:00";
  return `${dataDestino}T${hora}.000Z`;
}

const OFFSET_FUSO_PADRAO = "-03:00";

// Converte a data/hora local do CREARE para o instante UTC real. O offset padrao e o de Brasilia;
// SYNC_FUSO_OFFSET permite sobrescrever explicitamente para instalacoes em outro fuso.
export function dataHoraParaIso(dataHoraOrigem, offset = OFFSET_FUSO_PADRAO) {
  const [data = "", hora = "00:00:00"] = String(dataHoraOrigem).trim().split(" ");
  if (!data) return "";
  return offset ? new Date(`${data}T${hora}${offset}`).toISOString() : `${data}T${hora}.000Z`;
}

function vendaCancelada(status) {
  return (
    String(status ?? "")
      .trim()
      .toUpperCase() === "C"
  );
}

function itemCancelado(valor) {
  return ["1", "C", "S", "SIM", "TRUE"].includes(
    String(valor ?? "")
      .trim()
      .toUpperCase()
  );
}

// O CREARE, em alguns itens, grava desconto/acrescimo NEGATIVO (ex.: desconto -2,50 significa, na
// pratica, um acrescimo de 2,50). O schema de integracao exige >= 0 e rejeitava a venda inteira, entao
// normalizamos na ORIGEM: um valor negativo em um campo vira o valor absoluto no campo oposto. O total
// do item (lido direto do CREARE) NAO muda, pois o liquido net = -desconto + acrescimo e invariante:
//   desconto -2,50 -> acrescimo +2,50 : -(-2,50) + 0  ==  0 + 2,50
//   acrescimo -1,00 -> desconto +1,00 : -0 + (-1,00)  ==  -1,00 + 0
function normalizarDescontoAcrescimo(descontoBruto, acrescimoBruto) {
  let desconto = dinheiro(descontoBruto);
  let acrescimo = dinheiro(acrescimoBruto);
  if (desconto < 0) {
    acrescimo = dinheiro(acrescimo - desconto); // acrescimo + |desconto|
    desconto = 0;
  }
  if (acrescimo < 0) {
    desconto = dinheiro(desconto - acrescimo); // desconto + |acrescimo|
    acrescimo = 0;
  }
  return { desconto, acrescimo };
}

// Item de venda no formato do payload. Centralizado para producao e teste compartilharem exatamente
// a mesma normalizacao (a data e a unica diferenca entre os dois modos).
function montarItem(item, dataHoraItem) {
  const { desconto, acrescimo } = normalizarDescontoAcrescimo(item.desconto, item.acrescimo);
  return {
    idRegistro: `CREARE_ITEM:${item.idItemVendaBalcao}`,
    idProduto: texto(item.codigoProduto, `PRODUTO_${item.idProduto ?? item.idItemVendaBalcao}`),
    descricaoProduto: texto(item.descricaoProduto, "Produto sem descricao"),
    dataHoraItem,
    quantidade: Number(item.quantidade ?? 0),
    valorUnitario: dinheiro(item.valorUnitario),
    desconto,
    acrescimo,
    total: dinheiro(item.total),
    itemCancelado: itemCancelado(item.itemCancelado)
  };
}

function agruparPorVenda(linhas) {
  const grupos = new Map();
  for (const linha of linhas) {
    const chave = String(linha.idVendaBalcao);
    const grupo = grupos.get(chave) ?? [];
    grupo.push(linha);
    grupos.set(chave, grupo);
  }
  return grupos;
}

// A senha do gerente e usada somente pelo CREARE para autorizar o cancelamento e nunca e lida pelo
// agente. Esta estrutura leva apenas a auditoria persistida pela automacao.
function montarCancelamento(venda) {
  if (!vendaCancelada(venda.statusVenda)) return null;
  const usuarioId = textoOpcional(venda.cancelamentoUsuarioId);
  const usuarioNome = textoOpcional(venda.cancelamentoUsuarioNome);
  const justificativa = textoOpcional(venda.cancelamentoJustificativa);
  const motivo = textoOpcional(venda.cancelamentoMotivo);
  if (!usuarioId && !usuarioNome && !justificativa && !motivo) return null;
  return { usuarioId, usuarioNome, justificativa, motivo };
}

// Modo PRODUCAO: NAO reescreve datas nem usa prefixo TESTE. idVenda estavel (chave de idempotencia
// do servidor) = CREARE:<idVendaOriginal>; dataHoraVenda = a real (ver dataHoraParaIso). Reaproveita
// os mesmos helpers puros do modo teste.
export function montarPayloads({ vendas, itens, pagamentos }, { offsetFuso = OFFSET_FUSO_PADRAO } = {}) {
  const itensPorVenda = agruparPorVenda(itens);
  const pagamentosPorVenda = agruparPorVenda(pagamentos);

  return vendas.map((venda) => {
    const idVendaOriginal = String(venda.idVendaBalcao);
    const idVenda = `CREARE:${idVendaOriginal}`;
    const idCaixa = texto(venda.idDispositivo, `SEM_CAIXA_${idVendaOriginal}`);
    const nomeCaixa = texto(venda.nomeCaixa, `PDV ${idCaixa}`);
    const idCliente = venda.idCliente == null ? null : String(venda.idCliente);

    return {
      DadosIntegracao: { origem: "CREARE_COMPILART", modo: "producao", idVendaOriginal },
      Venda: {
        idVenda,
        idCaixa,
        nomeCaixa,
        idCliente,
        nomeCliente: venda.nomeCliente ?? null,
        documentoCliente: venda.documentoCliente ?? null,
        dataHoraVenda: dataHoraParaIso(venda.dataHoraVenda, offsetFuso),
        valorOriginal: dinheiro(venda.valorSubtotal ?? venda.valorTotal),
        desconto: dinheiro(venda.valorDesconto),
        acrescimo: dinheiro(venda.valorAcrescimo),
        valorTotal: dinheiro(venda.valorTotal),
        statusVenda: vendaCancelada(venda.statusVenda) ? "CANCELADA" : "FINALIZADA",
        numeroNotaFiscal: venda.numeroNotaFiscal == null ? null : String(venda.numeroNotaFiscal),
        cancelamento: montarCancelamento(venda)
      },
      ItensVenda: (itensPorVenda.get(idVendaOriginal) ?? []).map((item) =>
        montarItem(item, dataHoraParaIso(item.dataHoraItem ?? venda.dataHoraVenda, offsetFuso))
      ),
      PagamentosVenda: (pagamentosPorVenda.get(idVendaOriginal) ?? []).map((pagamento) => ({
        idVenda,
        idFormaPagamento: texto(pagamento.idFormaPagamento, `FORMA_${pagamento.idFormaPgtoVendaBalcao}`),
        descricaoFormaPagamento: texto(pagamento.descricaoFormaPagamento, "Forma sem descricao"),
        valor: dinheiro(pagamento.valor)
      }))
    };
  });
}

export function montarPayloadsTeste({ vendas, itens, pagamentos, dataOrigem, dataDestino = dataHojeLocal() }) {
  const itensPorVenda = agruparPorVenda(itens);
  const pagamentosPorVenda = agruparPorVenda(pagamentos);

  return vendas.map((venda) => {
    const idVendaOriginal = String(venda.idVendaBalcao);
    const idVenda = `CREARE:${idVendaOriginal}:TESTE:${dataDestino}`;
    const idCaixa = texto(venda.idDispositivo, `SEM_CAIXA_${idVendaOriginal}`);
    const nomeCaixa = texto(venda.nomeCaixa, `PDV ${idCaixa}`);
    const idCliente = venda.idCliente == null ? null : String(venda.idCliente);

    return {
      DadosIntegracao: {
        origem: "CREARE_COMPILART",
        modo: "teste_integracao",
        dataOrigem,
        dataDestino,
        idVendaOriginal
      },
      Venda: {
        idVenda,
        idCaixa,
        nomeCaixa,
        idCliente,
        nomeCliente: venda.nomeCliente ?? null,
        documentoCliente: venda.documentoCliente ?? null,
        dataHoraVenda: trocarDataPreservandoHora(venda.dataHoraVenda, dataDestino),
        valorOriginal: dinheiro(venda.valorSubtotal ?? venda.valorTotal),
        desconto: dinheiro(venda.valorDesconto),
        acrescimo: dinheiro(venda.valorAcrescimo),
        valorTotal: dinheiro(venda.valorTotal),
        statusVenda: vendaCancelada(venda.statusVenda) ? "CANCELADA" : "FINALIZADA",
        numeroNotaFiscal: venda.numeroNotaFiscal == null ? null : String(venda.numeroNotaFiscal),
        cancelamento: montarCancelamento(venda)
      },
      ItensVenda: (itensPorVenda.get(idVendaOriginal) ?? []).map((item) =>
        montarItem(item, trocarDataPreservandoHora(item.dataHoraItem ?? venda.dataHoraVenda, dataDestino))
      ),
      PagamentosVenda: (pagamentosPorVenda.get(idVendaOriginal) ?? []).map((pagamento) => ({
        idVenda,
        idFormaPagamento: texto(pagamento.idFormaPagamento, `FORMA_${pagamento.idFormaPgtoVendaBalcao}`),
        descricaoFormaPagamento: texto(pagamento.descricaoFormaPagamento, "Forma sem descricao"),
        valor: dinheiro(pagamento.valor)
      }))
    };
  });
}
