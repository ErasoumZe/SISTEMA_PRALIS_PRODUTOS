/** Apenas a classificação operacional explicitamente marcada S no SIA. */
export interface PesavelDaExportacao {
  codigoInterno: string;
  nome: string;
  validadeDias: number;
  status: string;
  linha: number;
}

const cabecalho = (valor: unknown) => String(valor ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const codigoSia = (valor: unknown): string | null => {
  const texto = String(valor ?? '').trim();
  return /^\d+$/.test(texto) ? texto.replace(/^0+(?=\d)/, '') : null;
};

export function lerPesaveisExportacao(linhas: unknown[][]) {
  const titulos = (linhas[0] ?? []).map(cabecalho);
  const indice = (titulo: string) => titulos.indexOf(titulo);
  const colunas = {
    codigo: indice('codproduto'),
    nome: indice('descricao'),
    status: indice('status'),
    pesavel: indice('pesavel'),
    validade: indice('validade'),
  };
  if (Object.values(colunas).some((i) => i < 0)) {
    throw new Error('A exportação precisa de Cód. produto, Descrição, Status, Pesável e Validade.');
  }

  const vistos = new Set<string>();
  const pesaveis: PesavelDaExportacao[] = [];
  const problemas: string[] = [];
  let produtos = 0;
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i] ?? [];
    const bruto = String(linha[colunas.codigo] ?? '').trim();
    if (!bruto) continue;
    produtos++;
    const codigo = codigoSia(bruto);
    if (!codigo) { problemas.push(`linha ${i + 1}: código inválido`); continue; }
    if (vistos.has(codigo)) { problemas.push(`linha ${i + 1}: código ${codigo} duplicado`); continue; }
    vistos.add(codigo);
    const classe = String(linha[colunas.pesavel] ?? '').trim().toUpperCase();
    if (classe !== 'S' && classe !== 'N') {
      problemas.push(`linha ${i + 1}: Pesável diferente de S/N para ${codigo}`);
      continue;
    }
    if (classe === 'N') continue;
    const nome = String(linha[colunas.nome] ?? '').trim();
    const validadeBruta = String(linha[colunas.validade] ?? '').trim();
    if (!nome || !/^\d{1,3}$/.test(validadeBruta)) {
      problemas.push(`linha ${i + 1}: pesável ${codigo} sem nome ou validade de 0 a 999 dias`);
      continue;
    }
    pesaveis.push({ codigoInterno: codigo, nome, validadeDias: Number(validadeBruta),
      status: String(linha[colunas.status] ?? '').trim(), linha: i + 1 });
  }
  if (produtos === 0 || pesaveis.length === 0) problemas.push('Nenhum produto pesável encontrado.');
  return { produtos, pesaveis, problemas };
}
