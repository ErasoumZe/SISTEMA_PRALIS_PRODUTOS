// Retry com backoff exponencial para o envio de vendas. Distingue tres casos:
//  - 4xx (exceto 429): erro PERMANENTE (payload invalido) — lanca de imediato, nao re-tenta.
//  - 429 (rate limit): NAO e erro; le o Retry-After e AGUARDA antes de tentar de novo (nunca
//    re-martela). Bonus: 429 nao consome o orcamento de tentativas transitorias.
//  - 5xx / rede: transitorio — backoff exponencial ate esgotar `tentativas`.

// Status HTTP do erro: prefere o campo estruturado (ErroHttp.status); cai para o texto por compat.
function statusDoErro(erro) {
  if (typeof erro?.status === "number") return erro.status;
  const casado = /HTTP (\d{3})/.exec(String(erro?.message ?? ""));
  return casado ? Number(casado[1]) : 0;
}

export function ehErro429(erro) {
  return statusDoErro(erro) === 429;
}

export function retryAfterMsDoErro(erro) {
  return typeof erro?.retryAfterMs === "number" ? erro.retryAfterMs : null;
}

export function ehErroPermanente(erro) {
  const status = statusDoErro(erro);
  return status >= 400 && status < 500 && status !== 429;
}

const esperarPadrao = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export async function enviarComRetry(
  enviar,
  { tentativas = 4, baseMs = 500, esperar = esperarPadrao, tentativas429 = 6, espera429Ms = 1000 } = {}
) {
  let ultimoErro;
  let esperas429 = 0;
  let tentativa = 0;
  while (tentativa < tentativas) {
    try {
      return await enviar();
    } catch (erro) {
      ultimoErro = erro;
      if (ehErroPermanente(erro)) throw erro;
      if (ehErro429(erro)) {
        // Rate limit: aguarda o Retry-After (ou um default) e tenta de novo, sem gastar `tentativas`.
        // Limitado por `tentativas429` para nao esperar para sempre se o servidor nunca liberar.
        if (esperas429 >= tentativas429) throw erro;
        esperas429 += 1;
        await esperar(retryAfterMsDoErro(erro) ?? espera429Ms);
        continue;
      }
      tentativa += 1;
      if (tentativa < tentativas) await esperar(baseMs * 2 ** (tentativa - 1));
    }
  }
  throw ultimoErro;
}
