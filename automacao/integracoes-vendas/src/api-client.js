// Erro HTTP com status e Retry-After estruturados. Deixa o retry decidir: 4xx (exceto 429) e
// permanente; 429 e "aguarde o Retry-After"; 5xx/rede e transitorio.
export class ErroHttp extends Error {
  constructor(mensagem, { status, retryAfterMs = null } = {}) {
    super(mensagem);
    this.name = "ErroHttp";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Le o header Retry-After (segundos ou data HTTP) e devolve em ms. null se ausente/invalido.
export function lerRetryAfterMs(resposta) {
  const bruto = resposta.headers?.get?.("retry-after");
  if (!bruto) return null;
  const segundos = Number(bruto);
  if (Number.isFinite(segundos)) return Math.max(0, Math.round(segundos * 1000));
  const data = Date.parse(bruto);
  return Number.isNaN(data) ? null : Math.max(0, data - Date.now());
}

export async function verificarApi(apiUrl) {
  try {
    const resposta = await fetch(`${apiUrl}/health`);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error);
    throw new Error(`Nao foi possivel conectar na API principal em ${apiUrl}. Detalhe: ${detalhe}`);
  }
}

// Conciliacao do dia: manda o agregado do CREARE e a API responde o comparativo por PDV.
// Mesma chave da ingestao. So le do lado do sistema — nada e gravado por esta chamada.
export async function enviarConciliacao({ apiUrl, codigoIntegracao, data, porPdv }) {
  const resposta = await fetch(`${apiUrl}/api/integracoes/conciliacao`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": codigoIntegracao },
    body: JSON.stringify({ data, porPdv })
  });

  const corpoTexto = await resposta.text();
  if (!resposta.ok) {
    throw new ErroHttp(`Falha na conciliacao de ${data}: HTTP ${resposta.status} ${corpoTexto}`, {
      status: resposta.status,
      retryAfterMs: lerRetryAfterMs(resposta)
    });
  }
  const corpo = corpoTexto ? JSON.parse(corpoTexto) : null;
  return corpo?.data ?? null;
}

export async function enviarVendaIntegracao({ apiUrl, codigoIntegracao, payload }) {
  const resposta = await fetch(`${apiUrl}/api/integracoes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": codigoIntegracao },
    body: JSON.stringify(payload)
  });

  const corpoTexto = await resposta.text();
  let corpo;
  try {
    corpo = corpoTexto ? JSON.parse(corpoTexto) : null;
  } catch {
    corpo = corpoTexto;
  }

  if (!resposta.ok) {
    throw new ErroHttp(`Falha ao enviar venda ${payload.Venda.idVenda}: HTTP ${resposta.status} ${corpoTexto}`, {
      status: resposta.status,
      retryAfterMs: lerRetryAfterMs(resposta)
    });
  }

  return corpo;
}
