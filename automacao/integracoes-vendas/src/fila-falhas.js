import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Fila em disco (array de payloads) para vendas que falharam por erro transitorio (rede/5xx) apos
// os retries. E reprocessada no inicio da proxima execucao. Inspiracao: o bot legado guardava os
// payloads pendentes em disco e reenviava no ciclo seguinte.

export async function lerFila(caminho) {
  try {
    const conteudo = await readFile(caminho, "utf8");
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

export async function gravarFila(caminho, itens) {
  await mkdir(path.dirname(caminho), { recursive: true });
  await writeFile(caminho, JSON.stringify(itens, null, 2), "utf8");
}
