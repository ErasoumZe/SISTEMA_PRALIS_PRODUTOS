/** Conciliação conservadora da classificação operacional da BASE SIA FULL. */
export interface LinhaPesavelSia {
  codigoInterno: string;
  pesavel: 'S' | 'N';
  teclaBalanca: number | null;
  validadeBalanca: number | null;
}

export interface ProdutoParaConciliar {
  id: string;
  codigoInterno: string | null;
  pesavel: string | null;
}

export const chaveCodigoSia = (valor: unknown): string | null => {
  const texto = String(valor ?? '').trim();
  return /^\d+$/.test(texto) ? texto.replace(/^0+(?=\d)/, '') : null;
};

const numeroBalanca = (valor: unknown): number | null => {
  const texto = String(valor ?? '').trim();
  return /^\d{1,3}$/.test(texto) ? Number(texto) : null;
};

/** Recebe H2:V da planilha, com cabeçalho na primeira linha. Não usa nome/unidade/barcode. */
export function lerPesavelSia(linhas: unknown[][]): { registros: Map<string, LinhaPesavelSia>; problemas: string[] } {
  const cabecalho = (linhas[0] ?? []).map((v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const indice = (nome: string) => cabecalho.indexOf(nome);
  const cod = indice('codproduto');
  const pesavel = indice('pesavel');
  const tecla = indice('tecla');
  const validade = indice('validade');
  if ([cod, pesavel, tecla, validade].some((i) => i < 0)) {
    throw new Error('BASE SIA FULL sem as colunas Cód. produto, Pesável, Tecla e Validade na linha 2.');
  }
  const registros = new Map<string, LinhaPesavelSia>();
  const problemas: string[] = [];
  const duplicados = new Set<string>();
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i] ?? [];
    if (!String(linha[cod] ?? '').trim()) continue;
    const chave = chaveCodigoSia(linha[cod]);
    const classe = String(linha[pesavel] ?? '').trim().toUpperCase();
    if (!chave || (classe !== 'S' && classe !== 'N')) {
      problemas.push(`linha ${i + 2}: código ou Pesável inválido`);
      continue;
    }
    if (registros.has(chave) || duplicados.has(chave)) {
      problemas.push(`linha ${i + 2}: Cód. produto ${chave} repetido`);
      registros.delete(chave);
      duplicados.add(chave);
      continue;
    }
    const teclaValor = numeroBalanca(linha[tecla]);
    const validadeValor = numeroBalanca(linha[validade]);
    if (classe === 'S' && (teclaValor === null || validadeValor === null)) {
      problemas.push(`linha ${i + 2}: pesável ${chave} sem Tecla/Validade válidas`);
      continue;
    }
    registros.set(chave, { codigoInterno: chave, pesavel: classe, teclaBalanca: teclaValor, validadeBalanca: validadeValor });
  }
  return { registros, problemas };
}

export function planejarPesavelSia(produtos: ProdutoParaConciliar[], fonte: Map<string, LinhaPesavelSia>) {
  const ocorrencias = new Map<string, number>();
  for (const p of produtos) {
    const chave = chaveCodigoSia(p.codigoInterno);
    if (chave) ocorrencias.set(chave, (ocorrencias.get(chave) ?? 0) + 1);
  }
  const atualizar: Array<{ id: string; fonte: LinhaPesavelSia }> = [];
  const resumo = { total: produtos.length, jaClassificados: 0, valorInesperado: 0, semCodigo: 0, semFonte: 0, codigoDuplicado: 0, conflitos: 0, atualizarS: 0, atualizarN: 0 };
  for (const p of produtos) {
    const chave = chaveCodigoSia(p.codigoInterno);
    if (!chave) { resumo.semCodigo++; continue; }
    if ((ocorrencias.get(chave) ?? 0) !== 1) { resumo.codigoDuplicado++; continue; }
    const registro = fonte.get(chave);
    if (p.pesavel === 'S' || p.pesavel === 'N') {
      resumo.jaClassificados++;
      if (registro && registro.pesavel !== p.pesavel) resumo.conflitos++;
      continue;
    }
    if (p.pesavel !== null) { resumo.valorInesperado++; continue; }
    if (!registro) { resumo.semFonte++; continue; }
    atualizar.push({ id: p.id, fonte: registro });
    if (registro.pesavel === 'S') resumo.atualizarS++;
    else resumo.atualizarN++;
  }
  return { atualizar, resumo };
}
