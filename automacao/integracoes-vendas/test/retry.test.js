import test from "node:test";
import assert from "node:assert/strict";
import { ehErro429, ehErroPermanente, enviarComRetry, retryAfterMsDoErro } from "../src/retry.js";
import { ErroHttp } from "../src/api-client.js";

const semEspera = async () => {};

test("retry: sucesso apos 2 falhas transitorias", async () => {
  let chamadas = 0;
  const enviar = async () => {
    chamadas += 1;
    if (chamadas < 3) throw new Error("network fail");
    return { data: { status: "criado" } };
  };
  const resposta = await enviarComRetry(enviar, { tentativas: 4, baseMs: 1, esperar: semEspera });
  assert.equal(resposta.data.status, "criado");
  assert.equal(chamadas, 3);
});

test("retry: 4xx nao re-tenta (permanente)", async () => {
  let chamadas = 0;
  const enviar = async () => {
    chamadas += 1;
    throw new Error("Falha ao enviar venda X: HTTP 400 invalido");
  };
  await assert.rejects(() => enviarComRetry(enviar, { tentativas: 4, baseMs: 1, esperar: semEspera }));
  assert.equal(chamadas, 1);
});

test("retry: esgota as tentativas em falha transitoria persistente", async () => {
  let chamadas = 0;
  const enviar = async () => {
    chamadas += 1;
    throw new Error("HTTP 503 indisponivel");
  };
  await assert.rejects(() => enviarComRetry(enviar, { tentativas: 3, baseMs: 1, esperar: semEspera }));
  assert.equal(chamadas, 3);
});

test("ehErroPermanente: 4xx true; 429/5xx/rede false", () => {
  assert.equal(ehErroPermanente(new Error("HTTP 400")), true);
  assert.equal(ehErroPermanente(new Error("HTTP 422")), true);
  assert.equal(ehErroPermanente(new ErroHttp("HTTP 429", { status: 429 })), false); // 429 NAO e permanente
  assert.equal(ehErroPermanente(new Error("HTTP 500")), false);
  assert.equal(ehErroPermanente(new Error("network fail")), false);
});

test("ehErro429 / retryAfterMsDoErro: leem o campo estruturado", () => {
  assert.equal(ehErro429(new ErroHttp("x", { status: 429, retryAfterMs: 2000 })), true);
  assert.equal(ehErro429(new Error("HTTP 500")), false);
  assert.equal(retryAfterMsDoErro(new ErroHttp("x", { status: 429, retryAfterMs: 2000 })), 2000);
  assert.equal(retryAfterMsDoErro(new Error("sem status")), null);
});

test("retry: 429 AGUARDA o Retry-After e conclui sem erro (nao re-martela)", async () => {
  let chamadas = 0;
  const esperas = [];
  const esperar = async (ms) => {
    esperas.push(ms);
  };
  const enviar = async () => {
    chamadas += 1;
    if (chamadas === 1) throw new ErroHttp("HTTP 429 Too Many Requests", { status: 429, retryAfterMs: 2000 });
    return { data: { status: "criado" } };
  };
  const resposta = await enviarComRetry(enviar, { tentativas: 4, baseMs: 1, esperar });
  assert.equal(resposta.data.status, "criado");
  assert.equal(chamadas, 2); // uma 429 + um sucesso
  assert.deepEqual(esperas, [2000]); // esperou exatamente o Retry-After
});

test("retry: 429 sem Retry-After usa o default e nao consome as tentativas transitorias", async () => {
  let chamadas = 0;
  const enviar = async () => {
    chamadas += 1;
    // sempre 429: deve esgotar o teto de 429 (tentativas429), nao o de transitorias (tentativas).
    throw new ErroHttp("HTTP 429", { status: 429 });
  };
  await assert.rejects(
    () => enviarComRetry(enviar, { tentativas: 2, baseMs: 1, esperar: semEspera, tentativas429: 3, espera429Ms: 5 }),
    ehErro429
  );
  // 3 esperas de 429 (o teto) => 4 chamadas; e NAO parou no `tentativas`=2 das transitorias.
  assert.equal(chamadas, 4);
});
