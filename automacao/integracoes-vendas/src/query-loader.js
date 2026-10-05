import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raizProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function carregarQuery(nomeArquivo) {
  const caminho = path.join(raizProjeto, "queries", nomeArquivo);
  return (await readFile(caminho, "utf8")).replace(/^\uFEFF/, "");
}
