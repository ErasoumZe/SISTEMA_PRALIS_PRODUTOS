import test from "node:test";
import assert from "node:assert/strict";
import {
  buscarVendasCanceladasDesde,
  buscarVendasDias,
  diasParaProcessar,
  inicioJanelaCancelamentos,
  subtrairDias
} from "../src/creare-repository.js";

test("subtrairDias: ancorado em UTC, atravessa virada de mes/ano", () => {
  assert.equal(subtrairDias("2026-07-18", 1), "2026-07-17");
  assert.equal(subtrairDias("2026-08-01", 1), "2026-07-31");
  assert.equal(subtrairDias("2026-01-01", 1), "2025-12-31");
  assert.equal(subtrairDias("2026-07-18", 0), "2026-07-18");
});

test("diasParaProcessar: mesmo dia reprocessa o dia corrente INTEIRO (venda atrasada nao se perde)", () => {
  // Ciclos seguintes no mesmo dia: sempre [hoje]. Como o dia inteiro e relido, uma venda que o PDV
  // sincronizou tarde (DTHR de mais cedo) entra no proximo ciclo — nao ha filtro por hora/cursor.
  assert.deepEqual(diasParaProcessar("2026-07-18", "2026-07-18", 1), ["2026-07-18"]);
});

test("diasParaProcessar: na virada do dia reprocessa tambem o dia anterior (uma vez)", () => {
  assert.deepEqual(diasParaProcessar("2026-07-18", "2026-07-17", 1), ["2026-07-17", "2026-07-18"]);
});

test("diasParaProcessar: 1a execucao respeita diasIniciais (backfill)", () => {
  assert.deepEqual(diasParaProcessar("2026-07-18", null, 1), ["2026-07-18"]);
  assert.deepEqual(diasParaProcessar("2026-07-18", null, 3), ["2026-07-16", "2026-07-17", "2026-07-18"]);
});

test("inicioJanelaCancelamentos: cobre venda antiga cancelada depois sem depender da data atualizacao", () => {
  assert.equal(inicioJanelaCancelamentos("2026-09-26", 1), "2026-09-26");
  assert.equal(inicioJanelaCancelamentos("2026-09-26", 7), "2026-09-20");
  assert.equal(inicioJanelaCancelamentos("2026-01-02", 90), "2025-10-05");
});

test("buscarVendasCanceladasDesde: busca o cabecalho cancelado e seus itens/pagamentos pelo ID", async () => {
  const chamadas = [];
  const pool = {
    async execute(sql, params) {
      chamadas.push({ sql, params });
      if (/FROM\s+venda_balcao/i.test(sql)) return [[{ idVendaBalcao: 55, statusVenda: "C" }]];
      if (/FROM\s+item_venda_balcao/i.test(sql)) return [[{ idVendaBalcao: 55, idItemVendaBalcao: 8 }]];
      if (/FROM\s+formapgto_venda_balcao/i.test(sql)) return [[{ idVendaBalcao: 55, idFormaPgtoVendaBalcao: 3 }]];
      return [[]];
    }
  };

  const dados = await buscarVendasCanceladasDesde(pool, "2026-09-20", "2026-09-26");
  assert.deepEqual(dados.vendas.map((venda) => venda.idVendaBalcao), [55]);
  assert.deepEqual(dados.itens.map((item) => item.idItemVendaBalcao), [8]);
  assert.deepEqual(dados.pagamentos.map((pagamento) => pagamento.idFormaPgtoVendaBalcao), [3]);
  assert.equal(chamadas.length, 3);
  assert.deepEqual(chamadas[0].params, ["2026-09-20", "2026-09-26"]);
  assert.deepEqual(chamadas[1].params, [55]);
  assert.deepEqual(chamadas[2].params, [55]);
});

// Fake do pool do mysql2: roteia por tabela na SQL e devolve as linhas do dia pedido (params[0]).
function poolFake(porDia) {
  return {
    async execute(sql, params) {
      const dia = String(params[0]);
      const dados = porDia[dia] ?? {};
      if (/FROM\s+item_venda_balcao/i.test(sql)) return [dados.itens ?? []];
      if (/FROM\s+formapgto_venda_balcao/i.test(sql)) return [dados.pagamentos ?? []];
      return [dados.vendas ?? []];
    }
  };
}

test("buscarVendasDias: relê o dia inteiro sem filtrar por hora — a venda atrasada entra", async () => {
  const pool = poolFake({
    "2026-07-18": {
      vendas: [
        { idVendaBalcao: 1, dataHoraVenda: "2026-07-18 08:00:00", valorTotal: 5 }, // chegou tarde, hora menor
        { idVendaBalcao: 2, dataHoraVenda: "2026-07-18 20:00:00", valorTotal: 7 }
      ]
    }
  });
  const { vendas } = await buscarVendasDias(pool, ["2026-07-18"]);
  assert.deepEqual(
    vendas.map((venda) => venda.idVendaBalcao),
    [1, 2]
  );
});

test("buscarVendasDias: concatena varios dias (base do reprocesso em faixa)", async () => {
  const pool = poolFake({
    "2026-07-01": { vendas: [{ idVendaBalcao: 10 }] },
    "2026-07-02": { vendas: [{ idVendaBalcao: 20 }, { idVendaBalcao: 21 }] }
  });
  const { vendas } = await buscarVendasDias(pool, ["2026-07-01", "2026-07-02"]);
  assert.deepEqual(
    vendas.map((venda) => venda.idVendaBalcao),
    [10, 20, 21]
  );
});
