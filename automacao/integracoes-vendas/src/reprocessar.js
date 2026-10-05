import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { enviarVendaIntegracao, verificarApi } from "./api-client.js";
import { buscarVendasDia, buscarVendasPorIds, enumerarDias, normalizarIds } from "./creare-repository.js";
import { criarPoolCreare } from "./database.js";
import { obterConfig } from "./env.js";
import { montarPayloads } from "./payload.js";
import { ehErro429, ehErroPermanente, enviarComRetry, retryAfterMsDoErro } from "./retry.js";
import { criarThrottle, intervaloDeReqPorSegundo } from "./throttle.js";

// REPROCESSO manual: re-le vendas no CREARE e reenvia para a API. Ferramenta de recuperacao para
// vendas que ficaram de fora da ingestao (ex.: falha durante um deploy). E idempotente — o servidor
// deduplica por idVenda + hash, entao vendas ja existentes voltam "sem_novidade" e as que faltavam
// sao criadas. NAO mexe no cursor, na fila nem no lock do agente: pode rodar com o agente no ar.

export const USO = `Uso:
  npm run reprocessar -- --dia 2026-07-15
  npm run reprocessar -- --ids 522987,523147,523369
  npm run reprocessar -- --de 2026-07-01 --ate 2026-07-20

Alvos (informe exatamente um):
  --dia YYYY-MM-DD          re-le o dia inteiro e reenvia todas as vendas.
  --ids a,b,c               reenvia apenas as vendas com esses ID_VENDA_BALCAO.
  --de YYYY-MM-DD --ate ..  reprocessa uma faixa de dias (backfill), dia a dia.

Idempotente e seguro: vendas ja existentes voltam "sem novidade"; as que
faltavam sao criadas. Nao altera o cursor nem a fila — pode rodar com o
agente/loop no ar.`;

// Erro de uso do CLI (argumentos invalidos). main() imprime a mensagem + o USO e sai com codigo 2.
export class ErroDeUso extends Error {}

function ehDataValida(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === texto;
}

function exigirData(rotulo, valor) {
  const texto = String(valor).trim();
  if (!ehDataValida(texto)) throw new ErroDeUso(`${rotulo} invalido: "${valor}". Use o formato YYYY-MM-DD.`);
  return texto;
}

// Interpreta os argumentos e devolve o alvo: { dia } | { ids } | { de, ate }. Puro e testavel.
export function interpretarArgumentos(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { dia: { type: "string" }, ids: { type: "string" }, de: { type: "string" }, ate: { type: "string" } },
      allowPositionals: false
    }));
  } catch (erro) {
    throw new ErroDeUso(erro instanceof Error ? erro.message : String(erro));
  }

  const temDia = typeof values.dia === "string" && values.dia.trim() !== "";
  const temIds = typeof values.ids === "string" && values.ids.trim() !== "";
  const temDe = typeof values.de === "string" && values.de.trim() !== "";
  const temAte = typeof values.ate === "string" && values.ate.trim() !== "";

  const modos = [temDia, temIds, temDe || temAte].filter(Boolean).length;
  if (modos !== 1) {
    throw new ErroDeUso("Informe exatamente um alvo: --dia, --ids OU --de/--ate.");
  }

  if (temDia) return { dia: exigirData("--dia", values.dia) };

  if (temIds) {
    let ids;
    try {
      ids = normalizarIds(values.ids);
    } catch (erro) {
      throw new ErroDeUso(erro instanceof Error ? erro.message : String(erro));
    }
    if (!ids.length) throw new ErroDeUso("--ids vazio. Informe ao menos um ID de venda.");
    return { ids };
  }

  if (!(temDe && temAte)) throw new ErroDeUso("Faixa requer --de e --ate juntos (YYYY-MM-DD).");
  const de = exigirData("--de", values.de);
  const ate = exigirData("--ate", values.ate);
  if (de > ate) throw new ErroDeUso(`Faixa invalida: --de (${de}) e posterior a --ate (${ate}).`);
  return { de, ate };
}

const DESCRICAO_STATUS = {
  criado: "CRIADA (estava faltando)",
  atualizado: "atualizada",
  sem_novidade: "sem novidade (ja existia igual)"
};

// Teto de reenfileiramentos por venda em caso de 429 persistente — evita girar sem fim.
const MAX_REENFILEIRAR_429 = 5;
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Envia os payloads (reusa throttle + retry + api-client). Loga o resultado de cada venda quando
// `detalhado` (modos --dia/--ids); na faixa fica silencioso e o chamador loga o resumo por dia.
// Fila interna: uma venda que falhar por 429 (mesmo depois do retry) NAO e pulada — volta para o fim
// da fila e e tentada de novo no proprio run (as outras seguem; o bucket do servidor reabastece).
async function enviarPayloads(config, payloads, { detalhado = true, throttle } = {}) {
  const sync = config.sincronizacao;
  const contagem = { total: payloads.length, criadas: 0, atualizadas: 0, semNovidade: 0, erros: 0 };
  const fila = payloads.map((payload) => ({ payload, reenfileiradas: 0 }));

  while (fila.length) {
    const item = fila.shift();
    const idVenda = item.payload.Venda.idVenda;
    try {
      const resposta = await enviarComRetry(
        async () => {
          await throttle();
          return enviarVendaIntegracao({
            apiUrl: config.padaria.apiUrl,
            codigoIntegracao: config.padaria.codigoIntegracao,
            payload: item.payload
          });
        },
        { tentativas: sync.retryTentativas, baseMs: sync.retryBaseMs }
      );
      const status = resposta?.data?.status ?? resposta?.status ?? "desconhecido";
      if (status === "criado") contagem.criadas += 1;
      else if (status === "atualizado") contagem.atualizadas += 1;
      else if (status === "sem_novidade") contagem.semNovidade += 1;
      if (detalhado) console.log(`[reprocessar] ${idVenda} -> ${DESCRICAO_STATUS[status] ?? status}`);
    } catch (erro) {
      if (ehErro429(erro) && item.reenfileiradas < MAX_REENFILEIRAR_429) {
        item.reenfileiradas += 1;
        fila.push(item);
        const espera = retryAfterMsDoErro(erro) ?? sync.retryBaseMs;
        console.warn(
          `[reprocessar] ${idVenda} -> 429; reenfileirado (${item.reenfileiradas}/${MAX_REENFILEIRAR_429}), ` +
            `aguardando ${espera}ms`
        );
        await esperar(espera);
      } else {
        contagem.erros += 1;
        const tipo = ehErroPermanente(erro) ? "permanente" : ehErro429(erro) ? "429 persistente" : "transitorio";
        console.error(`[reprocessar] ${idVenda} -> ERRO (${tipo}): ${erro instanceof Error ? erro.message : erro}`);
      }
    }
  }

  return contagem;
}

function somarContagem(total, parcial) {
  total.total += parcial.total;
  total.criadas += parcial.criadas;
  total.atualizadas += parcial.atualizadas;
  total.semNovidade += parcial.semNovidade;
  total.erros += parcial.erros;
  return total;
}

// Reprocessa um unico dia (com log por venda). Reusado pelos modos --dia e (silencioso) --de/--ate.
async function reprocessarDia(config, pool, dia, { detalhado = true, throttle } = {}) {
  const dados = await buscarVendasDia(pool, dia);
  const payloads = montarPayloads(dados, { offsetFuso: config.sincronizacao.offsetFuso });
  if (detalhado) console.log(`[reprocessar] dia=${dia}: ${payloads.length} venda(s) lida(s) no CREARE.`);
  return enviarPayloads(config, payloads, { detalhado, throttle });
}

async function reprocessarIds(config, pool, ids, throttle) {
  const dados = await buscarVendasPorIds(pool, ids);
  console.log(`[reprocessar] ids=${ids.join(",")}: ${dados.vendas.length} venda(s) lida(s) no CREARE.`);
  const encontrados = new Set(dados.vendas.map((venda) => String(venda.idVendaBalcao)));
  for (const id of ids) {
    if (!encontrados.has(String(id))) {
      console.warn(`[reprocessar] venda ${id}: NAO ENCONTRADA no CREARE (ignorada).`);
    }
  }
  const payloads = montarPayloads(dados, { offsetFuso: config.sincronizacao.offsetFuso });
  return enviarPayloads(config, payloads, { detalhado: true, throttle });
}

// Backfill: itera a faixa dia a dia reusando o fluxo do dia; log resumido por dia + total geral.
async function reprocessarFaixa(config, pool, de, ate, throttle) {
  const dias = enumerarDias(de, ate);
  console.log(`[reprocessar] faixa ${de}..${ate}: ${dias.length} dia(s).`);
  const total = { total: 0, criadas: 0, atualizadas: 0, semNovidade: 0, erros: 0 };
  for (const dia of dias) {
    const c = await reprocessarDia(config, pool, dia, { detalhado: false, throttle });
    somarContagem(total, c);
    console.log(
      `[reprocessar] dia=${dia}: lidas=${c.total} criadas=${c.criadas} atualizadas=${c.atualizadas} ` +
        `sem_novidade=${c.semNovidade} erros=${c.erros}`
    );
  }
  console.log(
    `[reprocessar] faixa ${de}..${ate} concluida: dias=${dias.length} total=${total.total} ` +
      `criadas=${total.criadas} atualizadas=${total.atualizadas} sem_novidade=${total.semNovidade} erros=${total.erros}`
  );
  return total;
}

// Abre a API + o pool uma unica vez e despacha para o modo do alvo. Devolve a contagem consolidada.
export async function reprocessar(config, alvo) {
  await verificarApi(config.padaria.apiUrl);

  // Throttle compartilhado por todo o run (todos os dias/vendas): teto de req/s abaixo do rate limit.
  const throttle = criarThrottle(intervaloDeReqPorSegundo(config.sincronizacao.maxReqPorSegundo));

  const pool = criarPoolCreare(config.creare);
  try {
    if (alvo.de) return await reprocessarFaixa(config, pool, alvo.de, alvo.ate, throttle);
    if (alvo.ids) return await reprocessarIds(config, pool, alvo.ids, throttle);

    const contagem = await reprocessarDia(config, pool, alvo.dia, { detalhado: true, throttle });
    console.log(
      `[reprocessar] dia=${alvo.dia} concluido: total=${contagem.total} criadas=${contagem.criadas} ` +
        `atualizadas=${contagem.atualizadas} sem_novidade=${contagem.semNovidade} erros=${contagem.erros}`
    );
    return contagem;
  } finally {
    await pool.end();
  }
}

async function main() {
  let alvo;
  try {
    alvo = interpretarArgumentos(process.argv.slice(2));
  } catch (erro) {
    if (erro instanceof ErroDeUso) {
      console.error(erro.message);
      console.error(`\n${USO}`);
      process.exitCode = 2;
      return;
    }
    throw erro;
  }

  const config = obterConfig();
  const contagem = await reprocessar(config, alvo);
  // Sai com erro se alguma venda falhou, para o operador (ou um agendador) perceber.
  if (contagem.erros > 0) process.exitCode = 1;
}

// So roda main() quando executado direto (node src/reprocessar.js); nao quando importado (testes).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
