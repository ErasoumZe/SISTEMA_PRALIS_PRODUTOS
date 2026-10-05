import { obterConfig } from "./env.js";
import { adquirirLock, atualizarLock, liberarLock } from "./lock.js";
import { derivarCaminhos, executarCiclo } from "./sincronizar.js";

// Sono interrompivel: dorme por ms, mas acorda na hora se interromper() for chamado (shutdown).
function criarSono() {
  let resolver = null;
  let timer = null;
  return {
    dormir(ms) {
      return new Promise((resolve) => {
        resolver = resolve;
        timer = setTimeout(() => {
          timer = null;
          resolver = null;
          resolve();
        }, ms);
      });
    },
    interromper() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (resolver) {
        const resolve = resolver;
        resolver = null;
        resolve();
      }
    }
  };
}

async function main() {
  const config = obterConfig();
  const sync = config.sincronizacao;
  const caminhos = derivarCaminhos(config);
  const maxIdadeMs = sync.lockMaxMinutos * 60_000;
  const intervaloMs = Math.max(1, sync.intervaloMinutos) * 60_000;

  if (!(await adquirirLock(caminhos.lockArquivo, { maxIdadeMs }))) {
    // Em producao a Tarefa do Windows reinicia processos que saem com erro. Sair com codigo 1
    // transforma um lock deixado por uma instancia antiga em espera/retry, em vez de deixar o novo
    // agente morto ate a proxima intervencao humana.
    console.error("[agente] outra execucao ja esta em andamento (lock ativo); aguardando reinicio da tarefa.");
    process.exitCode = 1;
    return;
  }

  let parar = false;
  const sono = criarSono();
  const encerrar = () => {
    parar = true;
    sono.interromper();
  };
  process.on("SIGINT", encerrar);
  process.on("SIGTERM", encerrar);

  console.log(`[agente] iniciado (intervalo=${sync.intervaloMinutos}min). Sinal de parada encerra com seguranca.`);
  try {
    while (!parar) {
      try {
        await atualizarLock(caminhos.lockArquivo); // heartbeat: mantem o lock fresco
        await executarCiclo(config, caminhos);
      } catch (erro) {
        // Um ciclo com erro (ex.: API fora do ar) nao derruba o agente — tenta de novo no proximo.
        console.error(`[agente] ciclo falhou: ${erro instanceof Error ? erro.message : erro}`);
      }
      if (parar) break;
      await sono.dormir(intervaloMs);
    }
  } finally {
    await liberarLock(caminhos.lockArquivo);
    console.log("[agente] encerrado.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
