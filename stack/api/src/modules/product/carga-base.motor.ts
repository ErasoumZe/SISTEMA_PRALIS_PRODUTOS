import { codigoCadastroValido, formatarCodigoCadastro } from './codigo-cadastro.motor';
import type { LinhaCarga } from './carga-base.planilha';

/**
 * CARGA DA BASE — decide, linha a linha, o que entra no cadastro.
 *
 * Motor PURO: sem banco, sem rede, sem injeção. Tudo o que ele sabe chega por
 * parâmetro, e por isso cada regra daqui tem teste próprio.
 *
 * A regra que manda em todas as outras: **o produto entra do jeito que está na
 * planilha** (José, 25/09/2026). Nada de "ativar porque parece ativo", nada de
 * completar unidade que não veio. O que a planilha não disser com clareza vira
 * recusa com motivo, nunca um palpite gravado em silêncio.
 */

/** O cadastro que vai ser criado. Campo ausente é `null`, nunca um chute. */
export interface ProdutoDaCarga {
  codigoInterno: string;
  nome: string;
  codigoBarras: string | null;
  medidaBase: string;
  tipo: 'revenda' | 'transformacao';
  status: 'ativo' | 'inativo';
  grupo: string | null;
  /** Id do grupo no Creare/SIA — coluna `HX`. Vai no `groupCode` do layout. */
  grupoId: string;
  estoqueMin: number | null;
  estoqueMax: number | null;
  custo: number | null;
  precoVenda: number | null;
}

export type MotivoRecusa =
  | 'codigo-invalido'
  | 'codigo-repetido-na-planilha'
  | 'sem-nome'
  | 'situacao-desconhecida'
  | 'unidade-desconhecida'
  | 'sem-id-de-grupo';

export interface DecisaoCarga {
  linha: number;
  codigo: string;
  nome: string;
  acao: 'importar' | 'recusar';
  motivo?: MotivoRecusa;
  produto?: ProdutoDaCarga;
}

export interface ResumoCarga {
  importar: number;
  recusas: Record<MotivoRecusa, number>;
  decisoes: DecisaoCarga[];
  /** Quantos entram ativos e quantos inativos, como a coluna `C` mandou. */
  ativos: number;
  inativos: number;
  /** Quantos entram com algum valor no campo de barras. */
  comBarras: number;
  /**
   * Valores que aparecem em mais de uma linha da coluna `F`.
   *
   * É AVISO, não recusa: o José pediu todos os produtos, e o banco não exige
   * código de barras único. Mas o PDV bipa um código e espera um produto, então
   * repetição precisa aparecer na tela em vez de virar surpresa no caixa.
   */
  barrasRepetidas: Array<{ codigoBarras: string; codigos: string[] }>;
  /** Grupos vistos, para a tela mostrar a carga por grupo antes de confirmar. */
  porGrupo: Array<{ grupoId: string; grupo: string | null; tipo: 'revenda' | 'transformacao'; quantidade: number }>;
}

const texto = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const digitos = (v: unknown): string => texto(v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');

const semAcento = (v: string): string => v.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();

/**
 * O código de barras da linha: **o que a coluna `F` tem, como está lá**.
 *
 * Em 6.434 das 7.347 linhas preenchidas o valor é o próprio código interno.
 * Não é engano da planilha: é o que o SIA guarda quando o produto não tem
 * etiqueta, e a célula guarda o número puro, sem zeros à esquerda (conferido
 * em 25/09/2026 lendo o valor cru, não o formatado).
 *
 * A carga anterior descartava esses valores. Esta não descarta, por instrução
 * do José em 25/09/2026: *"preciso de todos os produtos, que eles venham pro
 * sistema com os dados exatamente iguais ao e como estão na planilha"*. Copiar
 * é o que faz o cadastro voltar para o PDV igual ao que saiu dele.
 *
 * Isso é seguro porque a coluna não repete valor: os 913 códigos de barras de
 * verdade são distintos entre si, e os outros são o código interno, que também
 * é único. Se algum dia repetir, quem recusa é `colisaoDeBarras`.
 */
const codigoDeBarras = (bruto: string): string | null => digitos(bruto) || null;

/**
 * `H` para a unidade do cadastro.
 *
 * Só o que foi MEDIDO na coluna: UN (6.720), KG (648) e LT (1). Qualquer outra
 * coisa recusa a linha — inventar `UN` faria produto vendido por peso virar
 * produto vendido por unidade, e isso é preço errado na balança.
 */
const MEDIDA_BASE: Record<string, string> = { UN: 'UN', UNID: 'UN', KG: 'KG', L: 'LT', LT: 'LT' };

/**
 * `C` para a situação do cadastro.
 *
 * Medido: a coluna só tem ATIVO e INATIVO, sem vazio. Valor fora desses dois
 * recusa a linha, porque "entrar do jeito que está na planilha" exige saber
 * qual é o jeito.
 */
const SITUACAO: Record<string, 'ativo' | 'inativo'> = { ATIVO: 'ativo', INATIVO: 'inativo' };

/**
 * Ids de grupo que são FABRICAÇÃO PRÓPRIA — o que a padaria produz.
 *
 * Sai do nome que a própria coluna `M` dá a esses ids: de 65 a 74 todos são
 * `MER FAB. PRÓPRIA - …` (panificação, confeitaria, salgados, sanduíche,
 * almoço, saladas, massas, bebidas/copa, lanches/chapa, acréscimos).
 *
 * **Esta é a única coisa aqui que não vem escrita na planilha.** A aba não tem
 * coluna de IPPT, e a exportação do SIA tem `Produção` em branco em 3.035
 * linhas e discordando do grupo em outras 188 — não serve de fonte. O tipo
 * decide o IPPT do TXT do Creare e o controle de estoque, então a tela mostra
 * a contagem por grupo antes de confirmar, para a regra ser conferida por
 * quem manda nela e não descoberta depois no PDV.
 */
export const GRUPOS_DE_FABRICACAO_PROPRIA: readonly string[] = ['65', '66', '67', '68', '69', '70', '71', '72', '73', '74'];

const tipoDoGrupo = (grupoId: string): 'revenda' | 'transformacao' =>
  (GRUPOS_DE_FABRICACAO_PROPRIA.includes(grupoId) ? 'transformacao' : 'revenda');

/**
 * Número no formato da planilha (`1.234,56`) para número.
 *
 * Devolve `null` quando não dá para ler com certeza, e `null` vira campo vazio
 * no cadastro. Melhor faltar custo do que ter custo errado: custo errado não
 * fica só errado, ele calcula o preço de venda.
 */
const numero = (v: unknown): number | null => {
  const cru = texto(v).replace(/R\$\s*/i, '').replace(/%/g, '');
  if (!cru) return null;
  const normal = cru.includes(',') ? cru.replace(/\./g, '').replace(',', '.') : cru;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
};

const recusasZeradas = (): Record<MotivoRecusa, number> => ({
  'codigo-invalido': 0,
  'codigo-repetido-na-planilha': 0,
  'sem-nome': 0,
  'situacao-desconhecida': 0,
  'unidade-desconhecida': 0,
  'sem-id-de-grupo': 0,
});

/**
 * Planeja a carga.
 *
 * A ordem das recusas importa: primeiro o que desqualifica a linha como
 * produto, depois o que a planilha não soube dizer sobre ela. Assim o
 * relatório separa "isto não é um produto" de "falta um dado neste produto".
 *
 * Não há recusa por "já existe": esta é a carga de uma Base ZERADA. Duplicado
 * contra o que já está no banco é problema de quem decide zerar, e essa
 * decisão é do serviço, não daqui.
 */
export const planejarCarga = (linhas: readonly LinhaCarga[]): ResumoCarga => {
  const vezes = new Map<string, number>();
  for (const l of linhas) {
    const c = digitos(l.codigo);
    if (c) vezes.set(c, (vezes.get(c) ?? 0) + 1);
  }

  const recusas = recusasZeradas();
  const decisoes: DecisaoCarga[] = [];
  const aceitos = new Set<string>();
  const porBarras = new Map<string, string[]>();
  const grupos = new Map<string, { grupo: string | null; quantidade: number }>();
  let ativos = 0;
  let inativos = 0;
  let comBarras = 0;

  for (const l of linhas) {
    const codigo = digitos(l.codigo);
    const nome = texto(l.nome);
    const base = { linha: l.linha, codigo: codigo ? formatarCodigoCadastro(codigo) : '', nome };

    const recusar = (motivo: MotivoRecusa) => {
      recusas[motivo] += 1;
      decisoes.push({ ...base, acao: 'recusar', motivo });
    };

    if (!codigoCadastroValido(codigo)) { recusar('codigo-invalido'); continue; }
    if ((vezes.get(codigo) ?? 0) > 1 || aceitos.has(codigo)) { recusar('codigo-repetido-na-planilha'); continue; }
    if (!nome) { recusar('sem-nome'); continue; }

    const status = SITUACAO[semAcento(texto(l.situacao))];
    if (!status) { recusar('situacao-desconhecida'); continue; }

    const medidaBase = MEDIDA_BASE[semAcento(texto(l.unidade))];
    if (!medidaBase) { recusar('unidade-desconhecida'); continue; }

    /*
     * Sem id de grupo o produto até existiria no Pralis, mas não chegaria ao
     * PDV: `groupCode` é campo obrigatório de 4 dígitos no layout do Creare, e
     * o arquivo inteiro é recusado por causa de uma linha.
     */
    const grupoId = digitos(l.grupoId);
    if (!grupoId) { recusar('sem-id-de-grupo'); continue; }

    aceitos.add(codigo);
    const barras = codigoDeBarras(l.codigoBarras);
    if (barras) {
      comBarras += 1;
      const donos = porBarras.get(barras);
      if (donos) donos.push(codigo); else porBarras.set(barras, [codigo]);
    }
    if (status === 'ativo') ativos += 1; else inativos += 1;

    const grupo = texto(l.grupo) || null;
    const visto = grupos.get(grupoId);
    if (visto) { visto.quantidade += 1; if (!visto.grupo && grupo) visto.grupo = grupo; }
    else grupos.set(grupoId, { grupo, quantidade: 1 });

    decisoes.push({
      ...base,
      acao: 'importar',
      produto: {
        codigoInterno: formatarCodigoCadastro(codigo),
        nome,
        codigoBarras: barras,
        medidaBase,
        tipo: tipoDoGrupo(grupoId),
        status,
        grupo,
        grupoId,
        estoqueMin: numero(l.estoqueMin),
        estoqueMax: numero(l.estoqueMax),
        custo: numero(l.custo),
        precoVenda: numero(l.precoVenda),
      },
    });
  }

  return {
    importar: decisoes.filter((d) => d.acao === 'importar').length,
    recusas,
    decisoes,
    ativos,
    inativos,
    comBarras,
    barrasRepetidas: [...porBarras]
      .filter(([, codigos]) => codigos.length > 1)
      .map(([codigoBarras, codigos]) => ({ codigoBarras, codigos })),
    porGrupo: [...grupos]
      .map(([grupoId, v]) => ({ grupoId, grupo: v.grupo, tipo: tipoDoGrupo(grupoId), quantidade: v.quantidade }))
      .sort((a, b) => Number(a.grupoId) - Number(b.grupoId)),
  };
};

/**
 * O bloco fiscal com que todo produto da carga entra: **sequências de zero**,
 * por decisão do José em 25/09/2026.
 *
 * Os zeros respeitam a largura que o layout do Creare exige, porque zero de
 * tamanho errado não é zero, é campo fora de posição — e o TXT é posicional:
 * `ncm` 8, `cest` 7, `pisCofinsCst` 2, `ecfTaxCode` 2.
 *
 * `estado` e `motivo` existem justamente para esta situação: sem eles, produto
 * com fiscal zerado e produto com fiscal resolvido ficam iguais para quem
 * olha a tela, e o backfill não teria como saber quem ainda falta.
 */
export const FISCAL_ZERADO = {
  ncm: '00000000',
  cest: '0000000',
  cstPisCofins: '00',
  aliquotaEcfId: '00',
  aliquotaCheia: 0,
  aliquotaFcp: 0,
  aliquotaPis: 0,
  aliquotaCofins: 0,
  reducaoIcms: 0,
  icms: 0,
  /*
   * Estes ficam NULOS, não zerados: são texto descritivo ou código de tamanho
   * livre, e o layout do Creare não os escreve. `'0'` ali não seria "zero",
   * seria uma categoria chamada zero — um valor inventado, que é exatamente o
   * que a carga não faz.
   */
  categoria: null,
  aliquotaEcf: null,
  estado: 'zerado-na-carga',
  motivo: 'Carga inicial da Base: o bloco fiscal entrou zerado por decisão de 25/09/2026. O preenchimento real vem do backfill fiscal.',
} as const;

/**
 * O VÍNCULO entre a linha da planilha e o produto da Base.
 *
 * Existe por causa de um defeito visto em produção em 25/09/2026. A carga enche
 * a Base LENDO a planilha e sem escrever nada nela — senão devolveria 7.369
 * linhas para dentro da própria fonte. Só que o resto do sistema descobre "em
 * que linha mora este produto" procurando o identificador dele na coluna `ID`
 * da aba. Com a coluna vazia, nenhuma das 7.369 linhas era reconhecida, e
 * importar um produto da Base para a loja abria uma LINHA NOVA no fim em vez de
 * preencher o bloco da loja na linha que o produto já ocupava. Resultado
 * medido: o código 7 em duas linhas, a 11 e a 7380.
 *
 * O conserto é carimbar o identificador nas linhas que já existem. Nenhuma
 * linha nova, uma coluna só. Quem casa linha com produto é esta função, pelo
 * código interno, que é a chave da rede.
 */

export interface LinhaParaVincular {
  linha: number;
  codigo: string;
}

export interface ProdutoDaBase {
  id: string;
  codigoInterno: string | null;
}

export interface Vinculo {
  linha: number;
  produtoId: string;
  codigo: string;
}

export interface Pareamento {
  vinculos: Vinculo[];
  /** Linhas da planilha sem produto correspondente na Base. */
  linhasSemProduto: number[];
  /** Produtos da Base que não acharam linha — não têm por onde ser espelhados. */
  produtosSemLinha: string[];
  /**
   * Códigos que aparecem em mais de uma linha da planilha. Nenhuma delas é
   * vinculada: carimbar o identificador em duas linhas faria o sistema
   * escolher uma por sorte, e a outra viraria cadastro fantasma.
   */
  codigosRepetidos: Array<{ codigo: string; linhas: number[] }>;
}

export const parearLinhasComProdutos = (
  linhas: readonly LinhaParaVincular[],
  produtos: readonly ProdutoDaBase[],
): Pareamento => {
  const porCodigo = new Map<string, number[]>();
  for (const l of linhas) {
    const c = digitos(l.codigo);
    if (!c) continue;
    const jah = porCodigo.get(c);
    if (jah) jah.push(l.linha); else porCodigo.set(c, [l.linha]);
  }

  const codigosRepetidos = [...porCodigo]
    .filter(([, ls]) => ls.length > 1)
    .map(([codigo, ls]) => ({ codigo, linhas: [...ls].sort((a, b) => a - b) }));
  const repetidos = new Set(codigosRepetidos.map((r) => r.codigo));

  const vinculos: Vinculo[] = [];
  const produtosSemLinha: string[] = [];
  const usados = new Set<string>();

  for (const p of produtos) {
    const c = digitos(p.codigoInterno);
    const linhasDoCodigo = c ? porCodigo.get(c) : undefined;
    if (!c || !linhasDoCodigo || repetidos.has(c)) { produtosSemLinha.push(p.id); continue; }
    usados.add(c);
    vinculos.push({ linha: linhasDoCodigo[0]!, produtoId: p.id, codigo: c });
  }

  const linhasSemProduto = linhas
    .filter((l) => { const c = digitos(l.codigo); return !c || !usados.has(c); })
    .map((l) => l.linha);

  return {
    vinculos: vinculos.sort((a, b) => a.linha - b.linha),
    linhasSemProduto,
    produtosSemLinha,
    codigosRepetidos,
  };
};

/**
 * A coluna de identificadores, pronta para UMA escrita contígua.
 *
 * Escrever célula a célula seriam 7.369 faixas numa requisição só — o Google
 * recusa muito antes disso. Aqui sai um bloco único de `de` até `ate`.
 *
 * **Nunca apaga o que já está lá.** Valor existente é mantido como está, mesmo
 * quando diverge do vínculo: apagar identificador de linha que o sistema já
 * conhece desligaria aquele produto da planilha em silêncio.
 */
export const colunaDeIdentificadores = (
  vinculos: readonly Vinculo[],
  atuais: readonly string[],
  primeiraLinha: number,
): { valores: string[][]; de: number; ate: number; escritas: number } => {
  const porLinha = new Map(vinculos.map((v) => [v.linha, v.produtoId]));
  const ultimaComVinculo = vinculos.reduce((m, v) => Math.max(m, v.linha), primeiraLinha - 1);
  const ate = Math.max(ultimaComVinculo, primeiraLinha + atuais.length - 1);
  if (ate < primeiraLinha) return { valores: [], de: primeiraLinha, ate: primeiraLinha - 1, escritas: 0 };

  const valores: string[][] = [];
  let escritas = 0;
  for (let linha = primeiraLinha; linha <= ate; linha += 1) {
    const atual = String(atuais[linha - primeiraLinha] ?? '').trim();
    if (atual) { valores.push([atual]); continue; }
    const novo = porLinha.get(linha);
    if (novo) { valores.push([novo]); escritas += 1; } else valores.push(['']);
  }
  return { valores, de: primeiraLinha, ate, escritas };
};
