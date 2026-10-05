import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { adquirirLock, liberarLock } from "../src/lock.js";

const MAX = 30 * 60_000;

async function escreverLock(caminho, dados) {
  await mkdir(path.dirname(caminho), { recursive: true });
  await writeFile(caminho, JSON.stringify(dados), "utf8");
}

async function existe(caminho) {
  try {
    await readFile(caminho, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function comDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lock-"));
  try {
    await fn(path.join(dir, "agente.lock"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("adquirirLock: livre -> adquire e cria o arquivo", async () => {
  await comDir(async (arq) => {
    assert.equal(await adquirirLock(arq, { maxIdadeMs: MAX }), true);
    assert.equal(await existe(arq), true);
  });
});

test("adquirirLock: lock fresco de processo vivo (o proprio) -> recusa", async () => {
  await comDir(async (arq) => {
    const agora = new Date().toISOString();
    await escreverLock(arq, { pid: process.pid, host: os.hostname(), iniciadoEm: agora, atualizadoEm: agora });
    assert.equal(await adquirirLock(arq, { maxIdadeMs: MAX }), false);
  });
});

test("adquirirLock: PID morto -> rouba", async () => {
  await comDir(async (arq) => {
    const agora = new Date().toISOString();
    await escreverLock(arq, { pid: 999999, host: os.hostname(), iniciadoEm: agora, atualizadoEm: agora });
    assert.equal(await adquirirLock(arq, { maxIdadeMs: MAX }), true);
  });
});

test("adquirirLock: lock obsoleto (velho) -> rouba mesmo com pid vivo", async () => {
  await comDir(async (arq) => {
    const antigo = new Date(Date.now() - 60 * 60_000).toISOString();
    await escreverLock(arq, { pid: process.pid, host: os.hostname(), iniciadoEm: antigo, atualizadoEm: antigo });
    assert.equal(await adquirirLock(arq, { maxIdadeMs: MAX }), true);
  });
});

test("liberarLock: remove quando e nosso; mantem quando nao e", async () => {
  await comDir(async (arq) => {
    await adquirirLock(arq, { maxIdadeMs: MAX });
    await liberarLock(arq);
    assert.equal(await existe(arq), false);

    await escreverLock(arq, { pid: 999999, host: os.hostname(), iniciadoEm: new Date().toISOString() });
    await liberarLock(arq);
    assert.equal(await existe(arq), true);
  });
});
