import test from "node:test";
import assert from "node:assert/strict";
import { ErroDeUso, interpretarArgumentos } from "../src/reprocessar.js";
import { normalizarIds } from "../src/creare-repository.js";

test("interpretarArgumentos: --dia valido devolve { dia }", () => {
  assert.deepEqual(interpretarArgumentos(["--dia", "2026-07-15"]), { dia: "2026-07-15" });
});

test("interpretarArgumentos: --ids devolve inteiros unicos na ordem informada", () => {
  assert.deepEqual(interpretarArgumentos(["--ids", "522987,523147,523369"]), {
    ids: [522987, 523147, 523369]
  });
  assert.deepEqual(interpretarArgumentos(["--ids", "1,1,2, 2 ,3"]), { ids: [1, 2, 3] });
});

test("interpretarArgumentos: --de/--ate devolve a faixa", () => {
  assert.deepEqual(interpretarArgumentos(["--de", "2026-07-01", "--ate", "2026-07-20"]), {
    de: "2026-07-01",
    ate: "2026-07-20"
  });
  // Faixa de um unico dia e valida (de == ate).
  assert.deepEqual(interpretarArgumentos(["--de", "2026-07-05", "--ate", "2026-07-05"]), {
    de: "2026-07-05",
    ate: "2026-07-05"
  });
});

test("interpretarArgumentos: exige exatamente um alvo", () => {
  assert.throws(() => interpretarArgumentos([]), ErroDeUso);
  assert.throws(() => interpretarArgumentos(["--dia", "2026-07-15", "--ids", "1"]), ErroDeUso);
  assert.throws(
    () => interpretarArgumentos(["--de", "2026-07-01", "--ate", "2026-07-02", "--dia", "2026-07-01"]),
    ErroDeUso
  );
});

test("interpretarArgumentos: faixa exige --de e --ate juntos e na ordem certa", () => {
  assert.throws(() => interpretarArgumentos(["--de", "2026-07-01"]), ErroDeUso);
  assert.throws(() => interpretarArgumentos(["--ate", "2026-07-20"]), ErroDeUso);
  assert.throws(() => interpretarArgumentos(["--de", "2026-07-20", "--ate", "2026-07-01"]), ErroDeUso);
  assert.throws(() => interpretarArgumentos(["--de", "01/07/2026", "--ate", "2026-07-20"]), ErroDeUso);
});

test("interpretarArgumentos: --dia com formato ou data invalida falha", () => {
  assert.throws(() => interpretarArgumentos(["--dia", "15/07/2026"]), ErroDeUso);
  assert.throws(() => interpretarArgumentos(["--dia", "2026-13-40"]), ErroDeUso);
});

test("interpretarArgumentos: --ids nao-numerico falha", () => {
  assert.throws(() => interpretarArgumentos(["--ids", "1,abc,3"]), ErroDeUso);
  assert.throws(() => interpretarArgumentos(["--ids", ""]), ErroDeUso);
});

test("interpretarArgumentos: flag desconhecida vira ErroDeUso (mostra o uso)", () => {
  assert.throws(() => interpretarArgumentos(["--tudo"]), ErroDeUso);
});

test("normalizarIds: aceita array e string, deduplica preservando ordem", () => {
  assert.deepEqual(normalizarIds("10, 20, 10"), [10, 20]);
  assert.deepEqual(normalizarIds([3, "3", 1]), [3, 1]);
  assert.deepEqual(normalizarIds(""), []);
  assert.throws(() => normalizarIds("10,x"), /ID de venda invalido/);
});
