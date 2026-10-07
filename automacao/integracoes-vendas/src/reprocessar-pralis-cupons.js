import path from "node:path";
import { fileURLToPath } from "node:url";
import { criarPoolCreare } from "./database.js";
import { buscarVendasDia, enumerarDias } from "./creare-repository.js";
import { obterConfig } from "./env.js";
import { montarCuponsPralis, sincronizarPralis } from "./pralis-client.js";

export function interpretarFaixa(args) {
  if (args.length !== 4 || args[0] !== "--de" || args[2] !== "--ate") {
    throw new Error("Uso: node src/reprocessar-pralis-cupons.js --de AAAA-MM-DD --ate AAAA-MM-DD (maximo 31 dias)");
  }
  const [de, ate] = [args[1], args[3]];
  for (const data of [de, ate]) {
    const parsed = new Date(`${data}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== data) {
      throw new Error(`Data invalida: ${data}`);
    }
  }
  const dias = enumerarDias(de, ate);
  if (!dias.length || dias.length > 31) throw new Error("Faixa deve ter de 1 a 31 dias, em ordem crescente.");
  return dias;
}

async function main() {
  const dias = interpretarFaixa(process.argv.slice(2));
  const config = obterConfig();
  if (!config.pralis?.enviarCupons) throw new Error("Destino de cupons Pralis nao habilitado. Nao altera o Caixa.");
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const estado = path.isAbsolute(config.sincronizacao.estadoDir)
    ? config.sincronizacao.estadoDir : path.join(raiz, config.sincronizacao.estadoDir);
  const fila = path.join(estado, "fila-pralis-cupons-backfill.json");
  const pool = criarPoolCreare(config.creare);
  try {
    for (const dia of dias) {
      const { vendas, pagamentos } = await buscarVendasDia(pool, dia);
      const linhas = montarCuponsPralis({ vendas, pagamentos }, config.pralis.empresa);
      const r = await sincronizarPralis(config.pralis, fila, linhas, {
        tentativas: config.sincronizacao.retryTentativas,
        baseMs: config.sincronizacao.retryBaseMs
      }, undefined, { tipo: "venda_creare", chave: "ID_VENDA_BALCAO" });
      console.log(`[backfill-pralis-cupons] dia=${dia} cupons=${linhas.length} enviados=${r.enviados} pendentes=${r.pendentes}`);
      if (r.pendentes) throw new Error(`Dia ${dia}: lotes pendentes. Corrija a falha e repita a faixa.`);
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((erro) => { console.error(erro.message); process.exitCode = 1; });
}
