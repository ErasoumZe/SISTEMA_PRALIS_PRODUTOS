import { enviarVendaIntegracao, verificarApi } from "./api-client.js";
import { buscarUltimoDiaComDados, buscarVendasDia } from "./creare-repository.js";
import { criarPoolCreare } from "./database.js";
import { obterConfig } from "./env.js";
import { montarPayloadsTeste } from "./payload.js";

async function main() {
  const config = obterConfig();
  await verificarApi(config.padaria.apiUrl);

  const pool = criarPoolCreare(config.creare);
  try {
    const dataOrigem = await buscarUltimoDiaComDados(pool);
    if (!dataOrigem) throw new Error("Nenhuma venda encontrada no CREARE_COMPILART.");

    const dados = await buscarVendasDia(pool, dataOrigem);
    const payloads = montarPayloadsTeste({ ...dados, dataOrigem });

    if (!payloads.length) throw new Error(`Nenhuma venda encontrada para ${dataOrigem}.`);

    console.log(
      `Integracao de teste CREARE: dataOrigem=${dataOrigem}, vendas=${dados.vendas.length}, itens=${dados.itens.length}, pagamentos=${dados.pagamentos.length}`
    );

    let criados = 0;
    let atualizados = 0;
    let semNovidade = 0;

    for (const payload of payloads) {
      const resposta = await enviarVendaIntegracao({
        apiUrl: config.padaria.apiUrl,
        codigoIntegracao: config.padaria.codigoIntegracao,
        payload
      });
      const status = resposta?.data?.status ?? resposta?.status;
      if (status === "criado") criados += 1;
      else if (status === "atualizado") atualizados += 1;
      else if (status === "sem_novidade") semNovidade += 1;
    }

    console.log(`Concluido: criados=${criados}, atualizados=${atualizados}, sem_novidade=${semNovidade}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
