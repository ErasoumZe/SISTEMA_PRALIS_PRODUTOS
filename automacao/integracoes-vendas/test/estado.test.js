import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gravarCursor, lerCursor } from "../src/cursor.js";
import { gravarFila, lerFila } from "../src/fila-falhas.js";
import { enumerarDias } from "../src/creare-repository.js";

test("cursor: null quando nao existe; roundtrip cria diretorio e carimba atualizadoEm", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cursor-"));
  try {
    const arquivo = path.join(dir, "sub", "cursor.json");
    assert.equal(await lerCursor(arquivo), null);
    await gravarCursor(arquivo, { ultimaDataHoraVenda: "2026-07-05 14:30:00", ultimoIdVendaBalcao: 42 });
    const lido = await lerCursor(arquivo);
    assert.equal(lido.ultimaDataHoraVenda, "2026-07-05 14:30:00");
    assert.equal(lido.ultimoIdVendaBalcao, 42);
    assert.ok(lido.atualizadoEm);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fila: vazia quando nao existe; roundtrip preserva payloads", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fila-"));
  try {
    const arquivo = path.join(dir, "fila.json");
    assert.deepEqual(await lerFila(arquivo), []);
    await gravarFila(arquivo, [{ Venda: { idVenda: "CREARE:1" } }]);
    const lido = await lerFila(arquivo);
    assert.equal(lido.length, 1);
    assert.equal(lido[0].Venda.idVenda, "CREARE:1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("enumerarDias: inclusive, mesmo dia, ate<de vazio e virada de mes", () => {
  assert.deepEqual(enumerarDias("2026-07-03", "2026-07-05"), ["2026-07-03", "2026-07-04", "2026-07-05"]);
  assert.deepEqual(enumerarDias("2026-07-05", "2026-07-05"), ["2026-07-05"]);
  assert.deepEqual(enumerarDias("2026-07-06", "2026-07-05"), []);
  assert.deepEqual(enumerarDias("2026-07-30", "2026-08-01"), ["2026-07-30", "2026-07-31", "2026-08-01"]);
});
