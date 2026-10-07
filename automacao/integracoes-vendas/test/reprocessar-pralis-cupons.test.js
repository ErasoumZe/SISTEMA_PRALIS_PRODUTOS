import test from "node:test";
import assert from "node:assert/strict";
import { interpretarFaixa } from "../src/reprocessar-pralis-cupons.js";

test("backfill de cupons aceita ate 31 dias sem tocar no Caixa", () => {
  assert.deepEqual(interpretarFaixa(["--de", "2026-09-30", "--ate", "2026-10-02"]),
    ["2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.throws(() => interpretarFaixa(["--de", "2026-02-30", "--ate", "2026-03-01"]), /Data invalida/);
  assert.throws(() => interpretarFaixa(["--de", "2026-01-01", "--ate", "2026-02-02"]), /1 a 31 dias/);
});
