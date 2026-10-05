import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { montarLinhasPralis, sincronizarPralis } from "../src/pralis-client.js";

test("mapeia item, PDV, hora local e cancelamento real sem inferir pelo nome", () => {
  const venda = {
    idVendaBalcao: 42, idDispositivo: 2, nomeCaixa: "TNP-PC-CXPDV-2",
    dataHoraVenda: "2026-10-02 12:30:00", statusVenda: "F"
  };
  const item = {
    idItemVendaBalcao: 99, idVendaBalcao: 42, idProduto: 10824,
    codigoProduto: "00000000010824", descricaoProduto: "BISCOITO", quantidade: 0.2,
    valorUnitario: 86.9, total: 17.38, itemCancelado: 1,
    dataHoraItem: "2026-10-02 12:30:01"
  };
  const [linha] = montarLinhasPralis({ vendas: [venda], itens: [item] }, "TNP CENTRAL");
  assert.equal(linha.ID_ITEM_VENDA_BALCAO, "99");
  assert.equal(linha.ID_DISPOSITIVO, "2");
  assert.equal(linha.DATA_HORA_VENDA, "2026-10-02 12:30:00");
  assert.equal(linha.ITEM_CANCELADO, true);
  assert.equal(linha.VENDA_CONFIRMADA, true);
  assert.equal(linha.QUANTIDADE, "0.2");
  assert.equal(linha.EMPRESA, "TNP CENTRAL");
  assert.equal(linha.ATUALIZADO_EM, "2026-10-02 12:30:01");
  const [cancelada] = montarLinhasPralis({
    vendas: [{ ...venda, statusVenda: "C" }],
    itens: [{ ...item, itemCancelado: 0 }]
  }, "TNP CENTRAL");
  assert.equal(cancelada.ITEM_CANCELADO, true);
  assert.equal(cancelada.VENDA_CONFIRMADA, false);
  assert.equal(cancelada.VENDA_STATUS, "C");
});

test("mantem fila independente se Pralis falha e reenvia no ciclo seguinte", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pralis-client-test-"));
  const arquivo = path.join(dir, "fila.json");
  const linha = { ID_ITEM_VENDA_BALCAO: "1", TOTAL: "10" };
  try {
    const config = { apiUrl: "https://exemplo.invalid", token: "teste" };
    const falha = Object.assign(new Error("indisponivel"), { status: 503 });
    const primeiro = await sincronizarPralis(config, arquivo, [linha], { tentativas: 1 }, async () => { throw falha; });
    assert.equal(primeiro.pendentes, 1);
    assert.equal((JSON.parse(await readFile(arquivo, "utf8"))).length, 1);
    const lotes = [];
    const segundo = await sincronizarPralis(config, arquivo, [linha], { tentativas: 1 }, async (_config, lote) => {
      lotes.push(lote);
    });
    assert.equal(segundo.enviados, 1);
    assert.equal(segundo.pendentes, 0);
    assert.equal(lotes.length, 1);
    assert.equal((JSON.parse(await readFile(arquivo, "utf8"))).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
