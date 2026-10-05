import test from "node:test";
import assert from "node:assert/strict";
import { criarThrottle, intervaloDeReqPorSegundo } from "../src/throttle.js";

test("intervaloDeReqPorSegundo: converte req/s em ms (minimo 1 req/s)", () => {
  assert.equal(intervaloDeReqPorSegundo(4), 250);
  assert.equal(intervaloDeReqPorSegundo(1), 1000);
  assert.equal(intervaloDeReqPorSegundo(0), 1000); // clamp em 1 req/s
  assert.equal(intervaloDeReqPorSegundo(10), 100);
});

test("criarThrottle: espaça as concessoes pelo intervalo (relogio e espera injetados)", async () => {
  let t = 0;
  const esperas = [];
  const throttle = criarThrottle(250, {
    agora: () => t,
    esperar: async (ms) => {
      esperas.push(ms);
      t += ms; // a espera avanca o relogio simulado
    }
  });

  await throttle(); // 1a: sem espera, proximo=250
  await throttle(); // 2a: t=0 < 250 => espera 250, t=250, proximo=500
  await throttle(); // 3a: t=250 < 500 => espera 250, t=500, proximo=750

  assert.deepEqual(esperas, [250, 250]); // 1a nao espera; as seguintes espaçam 250ms
});

test("criarThrottle: nao espera quando ja passou tempo suficiente", async () => {
  let t = 0;
  const esperas = [];
  const throttle = criarThrottle(250, {
    agora: () => t,
    esperar: async (ms) => esperas.push(ms)
  });

  await throttle(); // proximo=250
  t = 1000; // passou muito tempo entre chamadas
  await throttle(); // t=1000 >= 250 => sem espera, proximo=1250

  assert.deepEqual(esperas, []);
});
