import test from "node:test";
import assert from "node:assert/strict";
import { dataHoraParaIso, montarPayloads } from "../src/payload.js";

test("montarPayloads: idVenda estavel CREARE:<id> (sem TESTE) e data real preservada", () => {
  const dados = {
    vendas: [
      {
        idVendaBalcao: 42,
        idDispositivo: "PDV1",
        nomeCaixa: "Caixa 1",
        idCliente: 7,
        nomeCliente: "Joao",
        documentoCliente: "123",
        dataHoraVenda: "2026-07-05 14:30:00",
        valorSubtotal: 10,
        valorDesconto: 1,
        valorAcrescimo: 0,
        valorTotal: 9,
        statusVenda: "F",
        numeroNotaFiscal: 55
      }
    ],
    itens: [
      {
        idItemVendaBalcao: 100,
        idVendaBalcao: 42,
        codigoProduto: "P1",
        descricaoProduto: "Pao",
        dataHoraItem: "2026-07-05 14:30:01",
        quantidade: 2,
        valorUnitario: 5,
        total: 10,
        itemCancelado: "0"
      }
    ],
    pagamentos: [
      {
        idFormaPgtoVendaBalcao: 9,
        idVendaBalcao: 42,
        idFormaPagamento: "DIN",
        descricaoFormaPagamento: "Dinheiro",
        valor: 9
      }
    ]
  };

  const [payload] = montarPayloads(dados);
  assert.equal(payload.Venda.idVenda, "CREARE:42");
  assert.ok(!payload.Venda.idVenda.includes("TESTE"));
  assert.equal(payload.Venda.dataHoraVenda, "2026-07-05T17:30:00.000Z");
  assert.equal(payload.DadosIntegracao.modo, "producao");
  assert.equal(payload.Venda.statusVenda, "FINALIZADA");
  assert.equal(payload.ItensVenda.length, 1);
  assert.equal(payload.ItensVenda[0].idRegistro, "CREARE_ITEM:100");
  assert.equal(payload.PagamentosVenda[0].idVenda, "CREARE:42");
});

test("montarPayloads: desconto negativo do CREARE vira acrescimo (total inalterado)", () => {
  const [payload] = montarPayloads({
    vendas: [{ idVendaBalcao: 1, dataHoraVenda: "2026-07-05 10:00:00", statusVenda: "F", valorTotal: 12.5 }],
    itens: [
      {
        idItemVendaBalcao: 10,
        idVendaBalcao: 1,
        codigoProduto: "P1",
        quantidade: 1,
        valorUnitario: 10,
        desconto: -2.5,
        acrescimo: 0,
        total: 12.5
      }
    ],
    pagamentos: []
  });
  const item = payload.ItensVenda[0];
  assert.equal(item.desconto, 0);
  assert.equal(item.acrescimo, 2.5);
  assert.equal(item.total, 12.5);
});

test("montarPayloads: acrescimo negativo do CREARE vira desconto (total inalterado)", () => {
  const [payload] = montarPayloads({
    vendas: [{ idVendaBalcao: 2, dataHoraVenda: "2026-07-05 10:00:00", statusVenda: "F", valorTotal: 9 }],
    itens: [
      {
        idItemVendaBalcao: 20,
        idVendaBalcao: 2,
        codigoProduto: "P2",
        quantidade: 1,
        valorUnitario: 10,
        desconto: 0,
        acrescimo: -1,
        total: 9
      }
    ],
    pagamentos: []
  });
  const item = payload.ItensVenda[0];
  assert.equal(item.desconto, 1);
  assert.equal(item.acrescimo, 0);
  assert.equal(item.total, 9);
});

test("montarPayloads: nunca emite desconto/acrescimo negativo, mesmo com ambos negativos", () => {
  const [payload] = montarPayloads({
    vendas: [{ idVendaBalcao: 3, dataHoraVenda: "2026-07-05 10:00:00", statusVenda: "F", valorTotal: 10 }],
    itens: [
      {
        idItemVendaBalcao: 30,
        idVendaBalcao: 3,
        codigoProduto: "P3",
        quantidade: 1,
        valorUnitario: 10,
        desconto: -2.5,
        acrescimo: -1,
        total: 11.5
      }
    ],
    pagamentos: []
  });
  const item = payload.ItensVenda[0];
  // net = -desconto + acrescimo = -(-2,50) + (-1,00) = 1,50 -> acrescimo 1,50, desconto 0
  assert.ok(item.desconto >= 0);
  assert.ok(item.acrescimo >= 0);
  assert.equal(item.desconto, 0);
  assert.equal(item.acrescimo, 1.5);
  assert.equal(item.total, 11.5);
});

test("montarPayloads: venda cancelada vira CANCELADA", () => {
  const [payload] = montarPayloads({
    vendas: [{ idVendaBalcao: 1, dataHoraVenda: "2026-07-05 10:00:00", statusVenda: "C", valorTotal: 5 }],
    itens: [],
    pagamentos: []
  });
  assert.equal(payload.Venda.statusVenda, "CANCELADA");
});

test("dataHoraParaIso: default de Brasilia e offset explicito geram UTC real", () => {
  assert.equal(dataHoraParaIso("2026-07-05 14:30:00"), "2026-07-05T17:30:00.000Z");
  assert.equal(dataHoraParaIso("2026-07-05 14:30:00", "-03:00"), "2026-07-05T17:30:00.000Z");
});
