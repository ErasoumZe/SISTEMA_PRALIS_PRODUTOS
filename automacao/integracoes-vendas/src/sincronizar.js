import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { enviarConciliacao, enviarVendaIntegracao, verificarApi } from "./api-client.js";
import {
  buscarConciliacaoDia,
  buscarIdsVendasFechadasDia,
  buscarVendasCanceladasDesde,
  buscarVendasDias,
  diaNegocioHoje,
  diasParaProcessar,
  inicioJanelaCancelamentos
} from "./creare-repository.js";
import { criarPoolCreare } from "./database.js";
import { obterConfig } from "./env.js";
import { montarPayloads } from "./payload.js";
import { gravarCursor, lerCursor } from "./cursor.js";
import { gravarFila, lerFila } from "./fila-falhas.js";
import { ehErroPermanente, enviarComRetry } from "./retry.js";
import { criarThrottle, intervaloDeReqPorSegundo } from "./throttle.js";
import { adquirirLock, liberarLock } from "./lock.js";
import { montarCuponsPralis, montarLinhasPralis, sincronizarPralis } from "./pralis-client.js";

const raizProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Caminhos do estado de runtime (cursor, fila e lock). Compartilhado pelo modo 1-ciclo e pelo loop.
export function derivarCaminhos(config) {
  const estadoDir = path.isAbsolute(config.sincronizacao.estadoDir)
    ? config.sincronizacao.estadoDir
    : path.join(raizProjeto, config.sincronizacao.estadoDir);
  return {
    estadoDir,
    cursorArquivo: path.join(estadoDir, "cursor.json"),
    filaArquivo: path.join(estadoDir, "fila-falhas.json"),
    filaPralisArquivo: path.join(estadoDir, "fila-pralis.json"),
    filaPralisCuponsArquivo: path.join(estadoDir, "fila-pralis-cupons.json"),
    lockArquivo: path.join(estadoDir, "agente.lock")
  };
}

function contarStatus(resposta, contagem) {
  const status = resposta?.data?.status ?? resposta?.status;
  if (status === "criado") contagem.criadas += 1;
  else if (status === "atualizado") contagem.atualizadas += 1;
  else if (status === "sem_novidade") contagem.semNovidade += 1;
}

// Junta o agregado por PDV (quantidade + valor) com a lista de IDs de venda fechada do dia, no mesmo
// formato que o sistema guarda (CREARE:<id>) — assim a API cruza e aponta os ausentes.
function montarPorPdvConciliacao(agregado, idsLinhas) {
  const idsPorPdv = new Map();
  for (const { pdvIdentificador, idVendaBalcao } of idsLinhas) {
    const lista = idsPorPdv.get(pdvIdentificador) ?? [];
    lista.push(`CREARE:${idVendaBalcao}`);
    idsPorPdv.set(pdvIdentificador, lista);
  }
  return agregado.map((pdv) => ({ ...pdv, idsVendas: idsPorPdv.get(pdv.pdvIdentificador) ?? [] }));
}

// Um ciclo de sincronizacao (sem lock — quem chama garante a exclusao). Reusado pelo modo 1-ciclo
// e pelo loop. Pode lancar (ex.: API fora do ar); o chamador decide se aborta ou tenta de novo.
export async function executarCiclo(config, caminhos) {
  const sync = config.sincronizacao;
  await verificarApi(config.padaria.apiUrl);

  // Throttle de saida (compartilhado por todas as vendas do ciclo, retries inclusive): segura o ritmo
  // abaixo do rate limit da API. Somado ao Retry-After no retry, nunca re-martela a API.
  const throttle = criarThrottle(intervaloDeReqPorSegundo(sync.maxReqPorSegundo));
  const enviar = (payload) =>
    enviarComRetry(
      async () => {
        await throttle();
        return enviarVendaIntegracao({
          apiUrl: config.padaria.apiUrl,
          codigoIntegracao: config.padaria.codigoIntegracao,
          payload
        });
      },
      { tentativas: sync.retryTentativas, baseMs: sync.retryBaseMs }
    );

  const contagem = {
    recebidas: 0,
    cancelamentosDetectados: 0,
    cancelamentosReenviados: 0,
    filaReprocessada: 0,
    criadas: 0,
    atualizadas: 0,
    semNovidade: 0,
    erros: 0
  };
  const falhas = [];

  async function processar(payload, ehReplay) {
    try {
      const resposta = await enviar(payload);
      contarStatus(resposta, contagem);
      if (ehReplay) contagem.filaReprocessada += 1;
    } catch (erro) {
      if (ehErroPermanente(erro)) {
        contagem.erros += 1;
        console.error(`[sincronizar] erro permanente na venda ${payload?.Venda?.idVenda}: ${erro.message}`);
      } else {
        falhas.push(payload);
      }
    }
  }

  // 1) Reprocessa a fila de falhas anteriores.
  for (const payload of await lerFila(caminhos.filaArquivo)) {
    await processar(payload, true);
  }

  // 2) Reprocesso do dia corrente inteiro (+ dia anterior na virada / backfill na 1a vez). O cursor
  //    e so otimizacao: mesmo sem ele o dia corrente inteiro entra, entao venda que chega tarde nao
  //    se perde. Dia no fuso do NEGOCIO — a mesma regra que a API usa para gravar data_referencia.
  const estado = await lerCursor(caminhos.cursorArquivo);
  const hoje = diaNegocioHoje();
  const dias = diasParaProcessar(hoje, estado?.ultimoDiaProcessado ?? null, sync.diasIniciais);

  // Agregado + IDs do dia corrente para a conciliacao: lidos com o pool ainda aberto, enviados depois.
  let porPdvCreare = null;
  let linhasPralis = [];
  let cuponsPralis = [];

  const pool = criarPoolCreare(config.creare);
  try {
    const { vendas, itens, pagamentos } = await buscarVendasDias(pool, dias);
    contagem.recebidas = vendas.length;

    const payloads = montarPayloads({ vendas, itens, pagamentos }, { offsetFuso: sync.offsetFuso });
    const idsEnviadosNoReprocessoNormal = new Set(payloads.map((payload) => payload.Venda.idVenda));
    for (const payload of payloads) {
      await processar(payload, false);
    }

    // Cancelamentos nao seguem necessariamente a data original da venda. Uma venda de dias atras
    // pode receber STATUS='C' agora; por isso ela entra nesta varredura dedicada. Se ela ja caiu no
    // reprocesso normal de hoje, nao enviamos duas vezes no mesmo ciclo.
    const inicioCancelamentos = inicioJanelaCancelamentos(hoje, sync.diasCancelamentos);
    const cancelamentos = await buscarVendasCanceladasDesde(pool, inicioCancelamentos, hoje);
    const payloadsCancelados = montarPayloads(cancelamentos, { offsetFuso: sync.offsetFuso });
    if (config.pralis?.enviarItens) {
      const normais = montarLinhasPralis({ vendas, itens }, config.pralis.empresa);
      const cancelados = montarLinhasPralis(cancelamentos, config.pralis.empresa);
      linhasPralis = [...new Map([...normais, ...cancelados].map((linha) => [linha.ID_ITEM_VENDA_BALCAO, linha])).values()];
    }
    if (config.pralis?.enviarCupons) {
      const normais = montarCuponsPralis({ vendas, pagamentos }, config.pralis.empresa);
      const cancelados = montarCuponsPralis(cancelamentos, config.pralis.empresa);
      cuponsPralis = [...new Map([...normais, ...cancelados].map((linha) => [linha.ID_VENDA_BALCAO, linha])).values()];
    }
    contagem.cancelamentosDetectados = payloadsCancelados.length;
    for (const payload of payloadsCancelados) {
      if (idsEnviadosNoReprocessoNormal.has(payload.Venda.idVenda)) continue;
      await processar(payload, false);
      contagem.cancelamentosReenviados += 1;
    }

    // Le o agregado + IDs DEPOIS de enviar as vendas do ciclo: assim compara o estado ja sincronizado.
    const [agregado, idsLinhas] = await Promise.all([
      buscarConciliacaoDia(pool, hoje),
      buscarIdsVendasFechadasDia(pool, hoje)
    ]);
    porPdvCreare = montarPorPdvConciliacao(agregado, idsLinhas);
  } finally {
    await pool.end();
  }

  // 3) Persiste fila e depois o cursor (marca o dia corrente como processado — otimiza a virada).
  await gravarFila(caminhos.filaArquivo, falhas);
  await gravarCursor(caminhos.cursorArquivo, { ultimoDiaProcessado: hoje });

  // Segundo destino independente: falha no Pralis nao interrompe o Caixa.
  // Fila propria em disco preserva lotes enquanto a API estiver indisponivel.
  const pralis = config.pralis?.enviarItens
    ? await sincronizarPralis(config.pralis, caminhos.filaPralisArquivo, linhasPralis, {
      tentativas: sync.retryTentativas, baseMs: sync.retryBaseMs
    })
    : null;
  const pralisCupons = config.pralis?.enviarCupons
    ? await sincronizarPralis(config.pralis, caminhos.filaPralisCuponsArquivo, cuponsPralis, {
      tentativas: sync.retryTentativas, baseMs: sync.retryBaseMs
    }, undefined, { tipo: "venda_creare", chave: "ID_VENDA_BALCAO" })
    : null;

  // 4) Log resumido do ciclo.
  console.log(
    `[sincronizar] dias=${dias.join(",")} recebidas=${contagem.recebidas} cancelamentos_detectados=${contagem.cancelamentosDetectados} ` +
      `cancelamentos_reenviados=${contagem.cancelamentosReenviados} fila_reprocessada=${contagem.filaReprocessada} ` +
      `criadas=${contagem.criadas} atualizadas=${contagem.atualizadas} sem_novidade=${contagem.semNovidade} ` +
      `erros=${contagem.erros} fila_pendente=${falhas.length}`
  );

  // 5) Conciliacao do dia (best-effort): nunca derruba o ciclo — as vendas ja foram entregues.
  const conciliacao = await conciliarDia(config, hoje, porPdvCreare);

  return { ...contagem, filaPendente: falhas.length, pralis, pralisCupons, conciliacao };
}

// Compara o agregado do CREARE com o sistema e loga PDV a PDV. A API e quem decide divergencia e
// dispara o e-mail aos admins; aqui so reportamos no console do ciclo (inclusive os IDs ausentes).
async function conciliarDia(config, dia, porPdv) {
  if (!porPdv) return null;
  try {
    const resultado = await enviarConciliacao({
      apiUrl: config.padaria.apiUrl,
      codigoIntegracao: config.padaria.codigoIntegracao,
      data: dia,
      porPdv
    });
    if (!resultado) return null;

    for (const pdv of resultado.porPdv) {
      const nome = pdv.pdvNome ?? pdv.pdvIdentificador;
      if (pdv.pdvNaoVinculado) {
        console.warn(`[conciliacao] ${dia} PDV ${nome}: SEM VINCULO no sistema (nao comparado)`);
      } else if (pdv.ok) {
        console.log(
          `[conciliacao] ${dia} PDV ${nome}: ok (${pdv.creare.quantidadeVendas} vendas, ${pdv.creare.valorTotal})`
        );
      } else {
        console.warn(
          `[conciliacao] ${dia} PDV ${nome}: DIVERGENTE sistema=${pdv.sistema.valorTotal} (${pdv.sistema.quantidadeVendas}) ` +
            `creare=${pdv.creare.valorTotal} (${pdv.creare.quantidadeVendas}) diferenca=${pdv.diferenca}`
        );
        if (pdv.idsFaltantes?.length) {
          console.warn(
            `[conciliacao] ${dia} PDV ${nome}: ${pdv.idsFaltantes.length} venda(s) no CREARE ausente(s) no sistema -> ` +
              `${pdv.idsFaltantes.join(", ")}`
          );
        }
      }
    }
    if (!resultado.porPdv.length) console.log(`[conciliacao] ${dia}: nenhuma venda fechada no CREARE.`);
    else if (resultado.ok) console.log(`[conciliacao] ${dia}: todos os PDVs batem.`);
    else console.warn(`[conciliacao] ${dia}: divergencia -> ${resultado.alertasEnviados} alerta(s) por e-mail.`);

    return resultado;
  } catch (erro) {
    console.error(`[conciliacao] falha ao conciliar ${dia}: ${erro instanceof Error ? erro.message : erro}`);
    return null;
  }
}

// Modo 1-CICLO (ex.: Agendador de Tarefas): adquire o lock, roda um ciclo e libera. Se ja houver
// execucao em andamento (lock ativo), pula — evita sobrepor com o loop ou outra tarefa agendada.
async function main() {
  const config = obterConfig();
  const caminhos = derivarCaminhos(config);
  const maxIdadeMs = config.sincronizacao.lockMaxMinutos * 60_000;

  if (!(await adquirirLock(caminhos.lockArquivo, { maxIdadeMs }))) {
    console.log("[sincronizar] outra execucao em andamento (lock ativo); pulando este ciclo.");
    return;
  }
  try {
    await executarCiclo(config, caminhos);
  } finally {
    await liberarLock(caminhos.lockArquivo);
  }
}

// So roda main() quando executado direto (node src/sincronizar.js); nao quando importado (loop.js).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
