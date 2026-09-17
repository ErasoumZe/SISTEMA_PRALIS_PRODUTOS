const FUNDO_PRALIS = "#EE7A1E";

type ProgressoFoto = (percentual: number) => void;

/** Remove o fundo localmente e compõe o produto sobre o laranja institucional. */
export async function aplicarFundoPralisComIa(
  arquivo: File,
  onProgress?: ProgressoFoto,
): Promise<File> {
  if (typeof window === "undefined")
    throw new Error("A padronizacao de foto so pode ser feita no navegador.");

  const { removeBackground: removerFundo } =
    await import("@imgly/background-removal");
  onProgress?.(5);
  const recorte = await removerFundo(arquivo, {
    progress: (_etapa, atual, total) => {
      if (total > 0) onProgress?.(5 + Math.round((atual / total) * 75));
    },
  });
  onProgress?.(82);

  const bitmap = await createImageBitmap(recorte);
  try {
    const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const contexto = canvas.getContext("2d");
    if (!contexto)
      throw new Error("Seu navegador nao conseguiu preparar a foto.");
    contexto.fillStyle = FUNDO_PRALIS;
    contexto.fillRect(0, 0, largura, altura);
    contexto.drawImage(bitmap, 0, 0, largura, altura);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (resultado) =>
          resultado
            ? resolve(resultado)
            : reject(new Error("Nao foi possivel gerar o PNG.")),
        "image/png",
      );
    });
    onProgress?.(100);
    const nome = arquivo.name.replace(/\.[^.]+$/, "") || "produto";
    return new File([png], `${nome}-cicluz.png`, {
      type: "image/png",
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
