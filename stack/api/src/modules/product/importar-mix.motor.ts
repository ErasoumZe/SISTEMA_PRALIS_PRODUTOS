import { codigoCadastroValido, formatarCodigoCadastro } from './codigo-cadastro.motor';

/**
 * Importação dos produtos da planilha MIX para a Base.
 *
 * Motor PURO. A regra que manda em tudo aqui: **nunca inventar valor**. Campo
 * que a planilha não traz, ou traz num formato que o cadastro não aceita, entra
 * vazio — e linha sem o mínimo para ser produto não entra de jeito nenhum.
 *
 * O contrário disso seria pior que não importar: produto com unidade chutada
 * vira preço errado na balança, e produto com tipo chutado cai na regra fiscal
 * errada.
 */

/** Uma linha da aba MIX com as colunas que o cadastro sabe usar. */
export interface LinhaMixCompleta {
  linha: number;
  /** `COD INTERNO` — é o `coditem` do PDV. */
  codigo: string;
  nome: string;
  codigoBarras: string | null;
  /** `ATIVO`: SIM / NÃO. */
  ativo: string;
  /** `IPPT`: T = de terceiro (revenda), P = próprio (transformação). */
  ippt: string;
  /** `MERCADORIAS` — o grupo de mercadoria. */
  grupo: string;
  marca: string;
  /** `EMB` — a embalagem de compra. */
  embalagem: string;
  /** `QUANT` — quantos vêm na embalagem. */
  quantidadeEmbalagem: string;
  /** `UNID/KG` — a unidade de venda. */
  unidade: string;
  setor: string;
  estoqueMin: string;
  estoqueMax: string;
  custo: string;
}

export type MotivoPulo =
  | 'codigo-invalido'
  | 'codigo-repetido-na-planilha'
  | 'sem-nome'
  | 'unidade-desconhecida'
  | 'tipo-desconhecido'
  | 'ja-existe-por-codigo'
  | 'ja-existe-por-barras';

/** O cadastro que vai ser criado. Campo ausente é `null`, nunca um palpite. */
export interface ProdutoNovo {
  codigoInterno: string;
  nome: string;
  codigoBarras: string | null;
  medidaBase: string;
  tipo: 'revenda' | 'transformacao';
  status: 'ativo' | 'inativo';
  grupo: string | null;
  marca: string | null;
  embalagem: string | null;
  qtCad: number | null;
  quantidade: number | null;
  setorEstoque: string | null;
  estoqueMin: number | null;
  estoqueMax: number | null;
  custo: number | null;
}

export interface DecisaoImportacao {
  linha: number;
  codigo: string;
  nome: string;
  acao: 'importar' | 'pular';
  motivo?: MotivoPulo;
  produto?: ProdutoNovo;
}

/** O que já existe no sistema, para não duplicar. */
export interface CadastroExistente {
  codigoInterno: string | null;
  codigoBarras: string | null;
}

const texto = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const digitos = (v: unknown): string => texto(v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/**
 * Número no formato da planilha (`1.234,56`) para número.
 *
 * Devolve `null` quando não dá para ler com certeza — e `null` vira campo vazio
 * no cadastro, que é o certo: melhor faltar custo do que ter custo errado.
 */
const numero = (v: unknown): number | null => {
  const cru = texto(v).replace(/R\$\s*/i, '').replace(/%/g, '');
  if (!cru) return null;
  // 1.234,56 (pt-BR) vs 1234.56
  const normal = cru.includes(',') ? cru.replace(/\./g, '').replace(',', '.') : cru;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
};

/**
 * `UNID/KG` da planilha para a unidade do cadastro.
 *
 * Só o que foi MEDIDO na aba (UNID, KG, L). Qualquer outra coisa devolve `null`
 * e a linha é pulada — inventar `UN` faria produto vendido por peso virar
 * produto vendido por unidade.
 */
const MEDIDA_BASE_DA_PLANILHA: Record<string, string> = { UNID: 'UN', UN: 'UN', KG: 'KG', L: 'LT', LT: 'LT' };

/** `EMB` para a embalagem do cadastro. `CONJ` não existe no cadastro: fica vazio. */
const EMBALAGEM_DA_PLANILHA: Record<string, string> = {
  UNID: 'UN', UN: 'UN', CX: 'CX', KG: 'KG', FD: 'FD', PCT: 'PCT', L: 'LT', LT: 'LT', SACO: 'SACO', POTE: 'POTE',
};

const semAcento = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

export interface ResumoImportacao {
  importar: number;
  pular: Record<MotivoPulo, number>;
  decisoes: DecisaoImportacao[];
}

const zerado = (): Record<MotivoPulo, number> => ({
  'codigo-invalido': 0,
  'codigo-repetido-na-planilha': 0,
  'sem-nome': 0,
  'unidade-desconhecida': 0,
  'tipo-desconhecido': 0,
  'ja-existe-por-codigo': 0,
  'ja-existe-por-barras': 0,
});

/**
 * Decide, linha a linha, o que entra no cadastro.
 *
 * A ordem das recusas importa: primeiro o que desqualifica a linha como
 * produto, depois o que diz que ela já está no sistema. Assim o relatório
 * separa "a planilha não me deu o suficiente" de "isto já existe aqui".
 */
export const planejarImportacao = (
  linhas: LinhaMixCompleta[],
  existentes: CadastroExistente[],
): ResumoImportacao => {
  const porCodigo = new Set<string>();
  const porBarras = new Set<string>();
  for (const e of existentes) {
    const c = digitos(e.codigoInterno);
    if (c) porCodigo.add(c);
    const b = digitos(e.codigoBarras);
    if (b) porBarras.add(b);
  }

  const vezesNaPlanilha = new Map<string, number>();
  for (const l of linhas) {
    const c = digitos(l.codigo);
    if (c) vezesNaPlanilha.set(c, (vezesNaPlanilha.get(c) ?? 0) + 1);
  }

  const pular = zerado();
  const decisoes: DecisaoImportacao[] = [];
  /** Códigos já aceitos nesta rodada — a planilha repete linha de vez em quando. */
  const aceitos = new Set<string>();

  for (const l of linhas) {
    const codigo = digitos(l.codigo);
    const nome = texto(l.nome);
    const base = { linha: l.linha, codigo: codigo ? formatarCodigoCadastro(codigo) : '', nome };

    const recusar = (motivo: MotivoPulo) => {
      pular[motivo] += 1;
      decisoes.push({ ...base, acao: 'pular', motivo });
    };

    if (!codigoCadastroValido(codigo)) { recusar('codigo-invalido'); continue; }
    if ((vezesNaPlanilha.get(codigo) ?? 0) > 1 || aceitos.has(codigo)) {
      recusar('codigo-repetido-na-planilha');
      continue;
    }
    if (!nome) { recusar('sem-nome'); continue; }

    const medidaBase = MEDIDA_BASE_DA_PLANILHA[semAcento(texto(l.unidade))];
    if (!medidaBase) { recusar('unidade-desconhecida'); continue; }

    const ippt = semAcento(texto(l.ippt));
    const tipo = ippt === 'T' ? 'revenda' : ippt === 'P' ? 'transformacao' : null;
    if (!tipo) { recusar('tipo-desconhecido'); continue; }

    if (porCodigo.has(codigo)) { recusar('ja-existe-por-codigo'); continue; }
    const barras = digitos(l.codigoBarras);
    if (barras && porBarras.has(barras)) { recusar('ja-existe-por-barras'); continue; }

    aceitos.add(codigo);
    const qtCad = numero(l.quantidadeEmbalagem);
    decisoes.push({
      ...base,
      acao: 'importar',
      produto: {
        codigoInterno: formatarCodigoCadastro(codigo),
        nome,
        codigoBarras: barras || null,
        medidaBase,
        tipo,
        /* ATIVO em branco não vira "ativo" por conveniência: só SIM é ativo. */
        status: semAcento(texto(l.ativo)) === 'SIM' ? 'ativo' : 'inativo',
        grupo: texto(l.grupo) || null,
        marca: texto(l.marca) || null,
        embalagem: EMBALAGEM_DA_PLANILHA[semAcento(texto(l.embalagem))] ?? null,
        // qtd da embalagem tem que ser inteiro >= 1 para o cadastro
        qtCad: qtCad !== null && Number.isInteger(qtCad) && qtCad >= 1 ? qtCad : null,
        quantidade: null,
        setorEstoque: texto(l.setor) || null,
        estoqueMin: numero(l.estoqueMin),
        estoqueMax: numero(l.estoqueMax),
        custo: numero(l.custo),
      },
    });
  }

  return { importar: decisoes.filter((d) => d.acao === 'importar').length, pular, decisoes };
};
