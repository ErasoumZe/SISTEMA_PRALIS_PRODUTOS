// Throttle simples de saida: garante um intervalo minimo entre chamadas (ex.: 250ms => 4 req/s).
// Evita que o agente estoure o rate limit da API num backfill. Serializa as concessoes: cada
// `aguardarVez()` so libera >= intervaloMs depois da anterior. `agora`/`esperar` sao injetaveis
// para teste.
// Converte um teto de req/s no intervalo minimo em ms entre chamadas (ex.: 4 => 250).
export function intervaloDeReqPorSegundo(maxReqPorSegundo) {
  const taxa = Math.max(1, Number(maxReqPorSegundo) || 1);
  return Math.ceil(1000 / taxa);
}

export function criarThrottle(
  intervaloMs,
  { agora = () => Date.now(), esperar = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}
) {
  const intervalo = Math.max(0, Number(intervaloMs) || 0);
  let proximo = 0; // instante mais cedo em que a proxima chamada pode ir
  let corrente = Promise.resolve(); // encadeia as concessoes para nao liberarem em paralelo

  async function conceder() {
    const t = agora();
    if (t < proximo) {
      await esperar(proximo - t);
      proximo += intervalo;
    } else {
      proximo = t + intervalo;
    }
  }

  return function aguardarVez() {
    corrente = corrente.then(conceder);
    return corrente;
  };
}
