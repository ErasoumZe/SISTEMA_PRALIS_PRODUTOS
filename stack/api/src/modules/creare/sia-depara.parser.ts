/**
 * Leitura e validação da exportação do SIA — sem tocar em banco.
 *
 * Está separado de `import-sia-depara.ts` de propósito: aquele módulo importa
 * `@/db/databases`, que abre conexão no load. Teste não pode carregar isso.
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

/** Mesma normalização de `barcodeCandidates`: só dígitos, sem zeros à esquerda. */
export const chaveDeBarras = (valor: unknown): string =>
  String(valor ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

const semAcento = (texto: string): string =>
  texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** As colunas que interessam, por nome — a exportação do SIA tem 340. */
const COLUNAS = {
  // First name: raw SIA export. Second name: normalized CSV in docs/.
  coditem: ['codproduto', 'coditem'],
  codigoBarras: ['codbarras'],
  descricao: ['descricao', 'nome'],
  codGrupo: ['codgrupo', 'grupo'],
  aliqSaidaEcf: ['aliqsaida', 'aliqecf'],
  reducao: ['reducao'],
  aliquotaInterna: ['aliqinterna'],
  cstSaida: ['cstsaida', 'cst'],
  csosn: ['csosnempresa', 'csosn'],
  ncm: ['ncm'],
  ativo: ['ativo'],
} as const;

type Campo = keyof typeof COLUNAS;

export function mapearColunas(cabecalho: unknown[]): Record<Campo, number> {
  const normalizado = cabecalho.map((c) => semAcento(String(c ?? '')));
  const indices = {} as Record<Campo, number>;
  const faltando: string[] = [];
  for (const [campo, nomes] of Object.entries(COLUNAS) as [Campo, readonly string[]][]) {
    const i = normalizado.findIndex((c) => nomes.includes(c));
    if (i < 0) faltando.push(campo);
    else indices[campo] = i;
  }
  if (faltando.length) {
    throw new Error(`Colunas não encontradas na exportação: ${faltando.join(', ')}.`);
  }
  return indices;
}

export interface LinhaDePara {
  coditem: string;
  codigoBarras: string;
  chaveBarras: string;
  descricao: string;
  codGrupo: string;
  aliqSaidaEcf: string;
  reducao: string | null;
  aliquotaInterna: string | null;
  cstSaida: string;
  csosn: string;
  ncm: string;
  ativo: string;
}

export interface ResultadoLeitura {
  linhas: LinhaDePara[];
  semBarras: number;
  barrasAmbiguas: Array<{ chave: string; coditens: string[] }>;
  coditensRepetidos: string[];
}

export function lerDePara(tabela: unknown[][]): ResultadoLeitura {
  const indices = mapearColunas(tabela[0] ?? []);
  const texto = (linha: unknown[], campo: Campo) => String(linha[indices[campo]] ?? '').trim();

  const porChave = new Map<string, string[]>();
  const porCoditem = new Map<string, number>();
  const linhas: LinhaDePara[] = [];
  let semBarras = 0;

  for (const linha of tabela.slice(1)) {
    const coditem = texto(linha, 'coditem');
    if (!coditem) continue;
    const codigoBarras = texto(linha, 'codigoBarras');
    const chaveBarras = chaveDeBarras(codigoBarras);
    // sem barras não há como casar com o produto do Pralis: fica de fora, e o
    // total aparece no resumo para ninguém achar que sumiu silenciosamente
    if (!chaveBarras) {
      semBarras += 1;
      continue;
    }

    porChave.set(chaveBarras, [...(porChave.get(chaveBarras) ?? []), coditem]);
    porCoditem.set(coditem, (porCoditem.get(coditem) ?? 0) + 1);
    const reducao = texto(linha, 'reducao').replace(',', '.');
    const aliquotaInterna = texto(linha, 'aliquotaInterna').replace(',', '.');

    linhas.push({
      coditem,
      codigoBarras,
      chaveBarras,
      descricao: texto(linha, 'descricao'),
      codGrupo: texto(linha, 'codGrupo'),
      aliqSaidaEcf: texto(linha, 'aliqSaidaEcf'),
      reducao: reducao && Number.isFinite(Number(reducao)) ? reducao : null,
      aliquotaInterna: aliquotaInterna && Number.isFinite(Number(aliquotaInterna)) ? aliquotaInterna : null,
      cstSaida: texto(linha, 'cstSaida'),
      csosn: texto(linha, 'csosn'),
      ncm: texto(linha, 'ncm'),
      ativo: texto(linha, 'ativo'),
    });
  }

  return {
    linhas,
    semBarras,
    barrasAmbiguas: [...porChave.entries()]
      .filter(([, coditens]) => coditens.length > 1)
      .map(([chave, coditens]) => ({ chave, coditens })),
    coditensRepetidos: [...porCoditem.entries()].filter(([, n]) => n > 1).map(([c]) => c),
  };
}

export function lerArquivo(caminho: string): unknown[][] {
  // Lemos o arquivo aqui em vez de usar `XLSX.readFile`: no build ESM o
  // SheetJS não vem com o `fs` ligado, e `readFile` simplesmente não existe.
  const wb = /\.csv$/i.test(caminho)
    ? XLSX.read(readFileSync(caminho, 'utf8'), { type: 'string', raw: true })
    : XLSX.read(readFileSync(caminho), { type: 'buffer' });
  const aba = wb.Sheets[wb.SheetNames[0]!]!;
  return XLSX.utils.sheet_to_json(aba, { header: 1, defval: '', raw: true });
}
