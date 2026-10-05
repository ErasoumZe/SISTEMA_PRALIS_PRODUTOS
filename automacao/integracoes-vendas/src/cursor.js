import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Cursor de sincronizacao persistido em disco: { ultimoDiaProcessado, atualizadoEm }, onde
// ultimoDiaProcessado e "YYYY-MM-DD" no fuso do negocio. E APENAS otimizacao (evita reprocessar o
// dia anterior a cada ciclo e marca a virada do dia), nunca fonte de verdade: se sumir ou vier de
// versao antiga, o ciclo ainda reprocessa o dia corrente inteiro (idempotente). lerCursor tolera
// qualquer forma antiga do arquivo (ex.: ultimaDataHoraVenda) — campos desconhecidos sao ignorados.

export async function lerCursor(caminho) {
  try {
    const conteudo = await readFile(caminho, "utf8");
    const dados = JSON.parse(conteudo);
    return dados && typeof dados === "object" ? dados : null;
  } catch {
    return null;
  }
}

export async function gravarCursor(caminho, cursor) {
  await mkdir(path.dirname(caminho), { recursive: true });
  const conteudo = JSON.stringify({ ...cursor, atualizadoEm: new Date().toISOString() }, null, 2);
  await writeFile(caminho, conteudo, "utf8");
}
