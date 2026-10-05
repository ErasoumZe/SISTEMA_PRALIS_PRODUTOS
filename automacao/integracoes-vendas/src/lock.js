import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Lock em arquivo para nao sobrepor execucoes (loop NSSM, tarefa agendada ou run manual). Guarda
// { pid, host, iniciadoEm, atualizadoEm }. Um lock so bloqueia se estiver FRESCO (idade abaixo do
// limite) E o processo dono ainda estiver VIVO. Caso contrario e considerado obsoleto e roubado.

async function lerLock(caminho) {
  try {
    const dados = JSON.parse(await readFile(caminho, "utf8"));
    return dados && typeof dados === "object" ? dados : null;
  } catch {
    return null;
  }
}

async function escreverLock(caminho, dados) {
  await mkdir(path.dirname(caminho), { recursive: true });
  await writeFile(caminho, JSON.stringify(dados, null, 2), "utf8");
}

function processoVivo(pid, host) {
  if (!pid) return false;
  if (host && host !== os.hostname()) return true; // outro host: nao da pra checar o pid; assume vivo
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro?.code === "EPERM"; // existe mas sem permissao para sinalizar = vivo
  }
}

function lockAtivo(info, maxIdadeMs) {
  if (!info?.pid) return false;
  const referencia = new Date(info.atualizadoEm ?? info.iniciadoEm ?? 0).getTime();
  const idade = Date.now() - referencia;
  if (!Number.isFinite(idade) || idade > maxIdadeMs) return false; // obsoleto
  return processoVivo(info.pid, info.host);
}

// Retorna true se conseguiu o lock (livre ou obsoleto), false se ja ha execucao ativa.
export async function adquirirLock(caminho, { maxIdadeMs }) {
  const info = await lerLock(caminho);
  if (lockAtivo(info, maxIdadeMs)) return false;
  const agora = new Date().toISOString();
  await escreverLock(caminho, { pid: process.pid, host: os.hostname(), iniciadoEm: agora, atualizadoEm: agora });
  return true;
}

// Heartbeat: renova o atualizadoEm do lock (usado pelo loop a cada ciclo) para nao envelhecer.
export async function atualizarLock(caminho) {
  const info = await lerLock(caminho);
  const iniciadoEm =
    info?.pid === process.pid ? (info.iniciadoEm ?? new Date().toISOString()) : new Date().toISOString();
  await escreverLock(caminho, {
    pid: process.pid,
    host: os.hostname(),
    iniciadoEm,
    atualizadoEm: new Date().toISOString()
  });
}

// Libera o lock somente se for nosso (evita apagar um lock ja roubado por outro processo).
export async function liberarLock(caminho) {
  const info = await lerLock(caminho);
  if (info?.pid === process.pid && info?.host === os.hostname()) {
    await unlink(caminho).catch(() => {});
  }
}
